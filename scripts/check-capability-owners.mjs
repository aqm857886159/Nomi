#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { resolveReferenceBaselines } from './check-vocabularies.mjs'
import {
  createStaticResolver,
  staticStringExpression as staticString,
  unwrapStaticExpression as unwrap,
} from './check-vocabularies-scan.mjs'
import {
  CANONICAL_ROLES,
  currentCutoverFailures,
  entryKey,
  factSite,
  historicalFailures,
  validateBaseline,
} from './check-capability-owners-baseline.mjs'
import {
  REQUIRED_CANONICAL_EXECUTION_SITES,
  inspectCanonicalExecutionDeclaration,
  isAttestedCanonicalControlFlow,
} from './check-capability-owners-execution.mjs'

const SOURCE_EXTENSION = /\.(?:ts|tsx|mts|cts)$/
const SKIP_PATH = /(?:^|\/)(?:node_modules|dist|release|build|\.tmp)(?:\/|$)|\.(?:test|spec)\.[^.]+$/
const RESULT_FIELDS = ['edges', 'groups', 'nodes', 'selectedNodeIds']
const CANONICAL_CANVAS_READ_FILE = 'electron/shared/agentCapabilities/canvasRead.ts'
const CANONICAL_MCP_ADAPTER_FILE = 'electron/capabilityCore/mcpCapabilityProjection.ts'
const CANONICAL_MCP_ADAPTER_SYMBOL = 'CANVAS_READ_MCP_ADAPTER'
const CANONICAL_MCP_TRANSPORT_ADAPTER_FILE = 'electron/capabilityCore/canvasReadTransportAdapters.ts'
const CANONICAL_MCP_TRANSPORT_ADAPTER_SYMBOL = 'createMcpCanvasReadTransportAdapter'
const CANONICAL_EXECUTOR_FILE = 'electron/capabilityCore/capabilityExecutorRegistry.ts'
const RETIRED_EXECUTION_SYMBOLS = new Set([
  'createLiveCanvasReadCapabilityAdapter',
  'createCapturedCanvasReadCapabilityAdapter',
  'routeCanvasToolCallBeforeAmbientGate',
  'legacyUnverifiedCanvasReadRoute',
  'verifiedProjectCanvasReadRoute',
  'readCanvasFromGateway',
])
const RETIRED_EXECUTION_MODULES = ['canvasReadCapabilityAdapter', 'canvasReadGatewayAdapter']

function readOption(argv, name, fallback) {
  const index = argv.indexOf(name)
  if (index === -1) return fallback
  if (!argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error(`${name} requires a value`)
  return argv[index + 1]
}

function walk(directory, output = []) {
  if (!fs.existsSync(directory)) return output
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name)
    const normalized = fullPath.split(path.sep).join('/')
    if (SKIP_PATH.test(normalized)) continue
    if (entry.isDirectory()) walk(fullPath, output)
    else if (SOURCE_EXTENSION.test(entry.name)) output.push(fullPath)
  }
  return output
}

function scriptKind(file) {
  return file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
}

function accessPath(node, sourceFile) {
  const current = unwrap(node)
  if (!current) return null
  if (ts.isIdentifier(current)) return current.text
  if (ts.isPropertyAccessExpression(current)) {
    const base = accessPath(current.expression, sourceFile)
    return base ? `${base}.${current.name.text}` : null
  }
  if (ts.isElementAccessExpression(current)) {
    const base = accessPath(current.expression, sourceFile)
    const key = staticString(current.argumentExpression)
    return base && key ? `${base}.${key}` : null
  }
  return null
}

function propertyName(node, sourceFile) {
  if (!node) return null
  if (ts.isComputedPropertyName(node)) return staticString(node.expression)
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return node.text
  return node.getText(sourceFile)
}

function namedProperty(object, name, sourceFile) {
  return object.properties.find(
    (property) =>
      (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
      propertyName(property.name, sourceFile) === name,
  )
}

function propertyExpression(property) {
  if (ts.isPropertyAssignment(property)) return property.initializer
  if (ts.isShorthandPropertyAssignment(property)) return property.name
  return null
}

function variableName(node) {
  for (let current = node; current; current = current.parent) {
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) return current.name.text
  }
  return null
}

function enclosingFunctionName(node, sourceFile) {
  for (let current = node; current; current = current.parent) {
    if (ts.isFunctionDeclaration(current) && current.name) return current.name.text
    if (ts.isMethodDeclaration(current)) return propertyName(current.name, sourceFile)
    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) return variableName(current)
  }
  return null
}

function typeMentions(typeNode, sourceFile, name) {
  return Boolean(typeNode && new RegExp(`\\b${name}\\b`).test(typeNode.getText(sourceFile)))
}

function isCanvasReadSpreadProjector(node, constants, sourceFile) {
  if (!ts.isFunctionDeclaration(node) || !node.body || !typeMentions(node.type, sourceFile, 'CanvasReadResult')) {
    return false
  }
  const inputParameters = new Set(
    node.parameters.map((parameter) => (ts.isIdentifier(parameter.name) ? parameter.name.text : null)).filter(Boolean),
  )
  if (inputParameters.size === 0) return false
  let clone = false
  function visit(current) {
    if (ts.isReturnStatement(current)) {
      const returned = constants.expression(current.expression)
      if (
        returned &&
        ts.isObjectLiteralExpression(returned) &&
        returned.properties.some((property) => {
          if (!ts.isSpreadAssignment(property)) return false
          const source = constants.expression(property.expression)
          return Boolean(source && ts.isIdentifier(source) && inputParameters.has(source.text))
        })
      ) {
        clone = true
      }
    }
    if (!clone) ts.forEachChild(current, visit)
  }
  visit(node.body)
  return clone
}

function zodObject(node) {
  const current = unwrap(node)
  if (!current || !ts.isCallExpression(current)) return null
  if (
    ts.isPropertyAccessExpression(current.expression) &&
    ts.isIdentifier(current.expression.expression) &&
    current.expression.expression.text === 'z' &&
    current.expression.name.text === 'object'
  ) {
    const argument = unwrap(current.arguments[0])
    return argument && ts.isObjectLiteralExpression(argument) ? argument : null
  }
  if (ts.isPropertyAccessExpression(current.expression)) return zodObject(current.expression.expression)
  return null
}

function objectKeys(object, sourceFile) {
  return object.properties
    .map((property) => ('name' in property ? propertyName(property.name, sourceFile) : null))
    .filter((name) => typeof name === 'string')
    .sort()
}

function wrappedObject(node, constants, sourceFile) {
  let current = unwrap(constants.expression(node))
  while (current && ts.isCallExpression(current)) {
    const wrapper = accessPath(current.expression, sourceFile)
    if ((wrapper !== 'Object.freeze' && wrapper !== 'immutableSchemaSnapshot') || current.arguments.length !== 1) {
      return null
    }
    current = unwrap(constants.expression(current.arguments[0]))
  }
  return current && ts.isObjectLiteralExpression(current) ? current : null
}

function directlyRequiresField(schema, field, constants, sourceFile) {
  const object = wrappedObject(schema, constants, sourceFile)
  const requiredProperty = object ? namedProperty(object, 'required', sourceFile) : null
  const required = requiredProperty ? unwrap(constants.expression(propertyExpression(requiredProperty))) : null
  return Boolean(
    required &&
    ts.isArrayLiteralExpression(required) &&
    required.elements.some((element) => !ts.isSpreadElement(element) && constants.string(element) === field),
  )
}

function sameStrings(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function containsCall(node) {
  let found = false
  function visit(current) {
    if (ts.isCallExpression(current)) {
      found = true
      return
    }
    if (!found) ts.forEachChild(current, visit)
  }
  visit(node)
  return found
}

function containsIdentifierCall(node, name) {
  let found = false
  function visit(current) {
    if (ts.isCallExpression(current) && accessPath(current.expression, current.getSourceFile()) === name) {
      found = true
      return
    }
    if (!found) ts.forEachChild(current, visit)
  }
  visit(node)
  return found
}

function enclosingFunction(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isFunctionLike(current)) return current
  }
  return null
}

function canonicalCapabilityReference(node, constants, sourceFile) {
  const pathValue = accessPath(constants.expression(node), sourceFile)
  if (pathValue === 'CANVAS_READ_CAPABILITY.id') return { kind: 'id' }
  if (pathValue === 'CANVAS_READ_CAPABILITY.aliases.pi') return { kind: 'alias', surface: 'pi' }
  if (pathValue === 'CANVAS_READ_CAPABILITY.aliases.mcp') return { kind: 'alias', surface: 'mcp' }
  const resolved = constants.string(node)
  if (resolved === 'canvas.read') return { kind: 'id' }
  if (resolved === 'read_canvas_state') return { kind: 'alias', surface: 'pi' }
  if (resolved === 'nomi_read_canvas') return { kind: 'alias', surface: 'mcp' }
  return null
}

function forbiddenSharedDependency(value) {
  return (
    value.startsWith('node:') ||
    value === 'electron' ||
    value.startsWith('electron/') ||
    value === 'react' ||
    value.startsWith('react/') ||
    value === 'zustand' ||
    value.startsWith('zustand/') ||
    /(?:^|\/)capabilityCore(?:\/|$)/.test(value) ||
    /(?:^|\/)src(?:\/|$)/.test(value)
  )
}

function entry(file, symbol, role, deleteIn = null) {
  return { file, symbol, role, deleteIn }
}

function scanFile(repoRoot, file) {
  const relative = path.relative(repoRoot, file).split(path.sep).join('/')
  const sourceFile = ts.createSourceFile(
    relative,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file),
  )
  const facts = []
  const violations = []
  const capabilityAware =
    /\b(?:CANVAS_READ_CAPABILITY|CanvasReadResult|projectCanvasRead)\b|canvas\.read|read_canvas_state|nomi_read_canvas/.test(
      sourceFile.text,
    )
  const constants = createStaticResolver(sourceFile)
  const canonicalLiteralNodes = new Set()
  const businessSwitches = []
  const mcpSafeExposureSites = []
  const mcpAdapterAttestations = []
  const mcpTransportAdapterAttestations = []
  const canonicalExecutionAttestations = []

  function add(symbol, role, deleteIn = null) {
    facts.push(entry(relative, symbol, role, deleteIn))
  }

  function visit(node) {
    const executionAttestation = inspectCanonicalExecutionDeclaration(node, relative)
    if (executionAttestation) {
      canonicalExecutionAttestations.push(executionAttestation)
      violations.push(...executionAttestation.violations)
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const object = zodObject(constants.expression(node.initializer))
      if (/canvas.*read.*input.*schema/i.test(node.name.text) && object && object.properties.length === 0) {
        add(node.name.text, 'canonical_input_schema_owner')
      }
      if (
        /canvas.*read.*(?:result|output).*schema/i.test(node.name.text) &&
        object &&
        sameStrings(objectKeys(object, sourceFile), RESULT_FIELDS)
      ) {
        add(node.name.text, 'canonical_output_schema_owner')
      }
      if (/canvas.*read.*effect/i.test(node.name.text) && constants.string(node.initializer) === 'read') {
        add(node.name.text, 'canonical_effect_owner')
      }
    }

    if (ts.isObjectLiteralExpression(node)) {
      const idProperty = namedProperty(node, 'id', sourceFile)
      const idReference = idProperty
        ? canonicalCapabilityReference(propertyExpression(idProperty), constants, sourceFile)
        : null
      const spreadsCanonicalContract = node.properties.some(
        (property) =>
          ts.isSpreadAssignment(property) &&
          accessPath(constants.expression(property.expression), sourceFile) === 'CANVAS_READ_CAPABILITY',
      )
      if (idProperty && idReference?.kind === 'id') {
        const owner = variableName(node) ?? '<anonymous>'
        canonicalLiteralNodes.add(unwrap(propertyExpression(idProperty)))
        add(`${owner}.id`, 'canonical_id_owner')
        const aliasesProperty = namedProperty(node, 'aliases', sourceFile)
        const aliasesExpression = aliasesProperty ? constants.expression(propertyExpression(aliasesProperty)) : null
        if (aliasesExpression && ts.isObjectLiteralExpression(aliasesExpression)) {
          for (const [surface, alias, role] of [
            ['pi', 'read_canvas_state', 'pi_alias_owner'],
            ['mcp', 'nomi_read_canvas', 'mcp_alias_owner'],
          ]) {
            const aliasProperty = namedProperty(aliasesExpression, surface, sourceFile)
            if (aliasProperty && constants.string(propertyExpression(aliasProperty)) === alias) {
              canonicalLiteralNodes.add(unwrap(propertyExpression(aliasProperty)))
              add(`${owner}.aliases.${surface}`, role)
            }
          }
        }
        const effectProperty = namedProperty(node, 'effect', sourceFile)
        if (effectProperty && constants.string(propertyExpression(effectProperty)) === 'read') {
          add(`${owner}.effect`, 'canonical_effect_owner')
        }
        const exposureProperty = namedProperty(node, 'exposure', sourceFile)
        if (exposureProperty && constants.string(propertyExpression(exposureProperty)) === 'legacy_unverified') {
          add(`${owner}.exposure`, 'legacy_authority_exposure_debt', 'Slice B')
        } else if (exposureProperty && constants.string(propertyExpression(exposureProperty)) === 'mcp_safe') {
          if (relative === CANONICAL_CANVAS_READ_FILE && owner === 'CANVAS_READ_CAPABILITY') {
            mcpSafeExposureSites.push(`${relative}::${owner}.exposure`)
          } else {
            violations.push(`self-asserted mcp_safe exposure for canvas.read in ${relative}::${owner}`)
          }
        }
      }

      if (spreadsCanonicalContract) {
        const owner = variableName(node) ?? '<anonymous>'
        const inputProperty = namedProperty(node, 'inputSchema', sourceFile)
        const inputObject = inputProperty ? zodObject(constants.expression(propertyExpression(inputProperty))) : null
        if (inputObject && inputObject.properties.length === 0) {
          add(`${owner}.inputSchema`, 'canonical_input_schema_owner')
          violations.push(`spread canvas.read contract shadows its canonical input schema (${relative})`)
        }
        const outputProperty = namedProperty(node, 'outputSchema', sourceFile)
        const outputObject = outputProperty ? zodObject(constants.expression(propertyExpression(outputProperty))) : null
        if (outputObject && sameStrings(objectKeys(outputObject, sourceFile), RESULT_FIELDS)) {
          add(`${owner}.outputSchema`, 'canonical_output_schema_owner')
        }
        const effectProperty = namedProperty(node, 'effect', sourceFile)
        if (effectProperty && constants.string(propertyExpression(effectProperty)) === 'read') {
          add(`${owner}.effect`, 'canonical_effect_owner')
        }
        const exposureProperty = namedProperty(node, 'exposure', sourceFile)
        if (exposureProperty && constants.string(propertyExpression(exposureProperty)) === 'mcp_safe') {
          violations.push(`self-asserted mcp_safe exposure for canvas.read in ${relative}::${owner}`)
        }
      }

      const contractProperty = namedProperty(node, 'contract', sourceFile)
      const contractExpression = contractProperty
        ? accessPath(constants.expression(propertyExpression(contractProperty)), sourceFile)
        : null
      if (contractExpression === 'CANVAS_READ_CAPABILITY') {
        const portProperty = namedProperty(node, 'port', sourceFile)
        const portExpression = portProperty ? unwrap(propertyExpression(portProperty)) : null
        if (portExpression && ts.isObjectLiteralExpression(portExpression)) {
          const accessProperty = namedProperty(portExpression, 'access', sourceFile)
          const access = accessProperty ? constants.string(propertyExpression(accessProperty)) : null
          if (access === 'write' || access === 'paid') {
            violations.push(`canvas.read cannot bind a ${access} port (${relative})`)
          }
        }

        const authorityProperty = namedProperty(node, 'authority', sourceFile)
        const transportProperty = namedProperty(node, 'transportInputSchema', sourceFile)
        const parseCallProperty = namedProperty(node, 'parseCall', sourceFile)
        if (authorityProperty || transportProperty || parseCallProperty) {
          const symbol = variableName(node) ?? '<anonymous>'
          const exactSite = relative === CANONICAL_MCP_ADAPTER_FILE && symbol === CANONICAL_MCP_ADAPTER_SYMBOL
          if (!exactSite) {
            violations.push(`self-asserted mcp_safe adapter for canvas.read in ${relative}::${symbol}`)
          } else {
            const authority = authorityProperty
              ? wrappedObject(propertyExpression(authorityProperty), constants, sourceFile)
              : null
            const kindProperty = authority ? namedProperty(authority, 'kind', sourceFile) : null
            const scopeProperty = authority ? namedProperty(authority, 'requiredScope', sourceFile) : null
            const routeProperty = authority ? namedProperty(authority, 'route', sourceFile) : null
            mcpAdapterAttestations.push({
              site: `${relative}::${symbol}`,
              projectSession:
                Boolean(kindProperty) && constants.string(propertyExpression(kindProperty)) === 'project_session',
              routeFree: !routeProperty,
              canonicalScope:
                Boolean(scopeProperty) &&
                accessPath(constants.expression(propertyExpression(scopeProperty)), sourceFile) ===
                  'CANVAS_READ_CAPABILITY.requiredScope',
              leaseRequired:
                Boolean(transportProperty) &&
                directlyRequiresField(propertyExpression(transportProperty), 'leaseHandle', constants, sourceFile),
            })
          }
        }
      }
    }

    if (ts.isFunctionDeclaration(node) && node.name) {
      if (node.name.text === 'projectCanvasRead') add(node.name.text, 'safe_projector')
      else if (isCanvasReadSpreadProjector(node, constants, sourceFile)) add(node.name.text, 'safe_projector')
      if (node.name.text === 'createLiveCanvasReadCapabilityAdapter') {
        add(node.name.text, 'renderer_environment_execution_seam', 'Slice B')
      }
      if (node.name.text === 'legacyUnverifiedCanvasReadRoute') {
        add(node.name.text, 'main_gateway_route_execution_seam', 'Slice B')
      }
      if (RETIRED_EXECUTION_SYMBOLS.has(node.name.text)) {
        violations.push(`retired canvas.read execution seam reintroduced: ${relative}::${node.name.text}`)
      }
      if (
        relative === CANONICAL_MCP_TRANSPORT_ADAPTER_FILE &&
        node.name.text === CANONICAL_MCP_TRANSPORT_ADAPTER_SYMBOL
      ) {
        mcpTransportAdapterAttestations.push({
          site: `${relative}::${node.name.text}`,
          verifiedFactory: containsIdentifierCall(node, 'createMcpCanvasReadVerifiedInvocationFactory'),
          executor: containsIdentifierCall(node, 'input.executor.execute'),
        })
      }
    }

    if (
      capabilityAware &&
      ts.isObjectLiteralExpression(node) &&
      sameStrings(objectKeys(node, sourceFile), RESULT_FIELDS)
    ) {
      const functionName = enclosingFunctionName(node, sourceFile)
      const parentCall = node.parent
      const isZodShape =
        ts.isCallExpression(parentCall) &&
        ts.isPropertyAccessExpression(parentCall.expression) &&
        accessPath(parentCall.expression, sourceFile) === 'z.object'
      if (functionName && !isZodShape) add(functionName, 'safe_projector')
    }

    if (capabilityAware && ts.isArrayLiteralExpression(node)) {
      const values = constants.strings(node)
      if (values && sameStrings(values, RESULT_FIELDS)) {
        const symbol = enclosingFunctionName(node, sourceFile) ?? variableName(node) ?? '<anonymous>'
        add(symbol, 'safe_projector')
        violations.push(`field whitelist owner duplicates the safe projector: ${relative}::${symbol}`)
      }
    }

    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const dependency = node.moduleSpecifier ? constants.string(node.moduleSpecifier) : null
      if (dependency && RETIRED_EXECUTION_MODULES.some((name) => dependency.endsWith(`/${name}`))) {
        violations.push(`retired canvas.read execution seam import reintroduced: ${relative} -> ${dependency}`)
      }
      if (
        ts.isImportDeclaration(node) &&
        node.importClause?.namedBindings &&
        ts.isNamedImports(node.importClause.namedBindings)
      ) {
        for (const imported of node.importClause.namedBindings.elements) {
          const importedName = imported.propertyName?.text ?? imported.name.text
          if (RETIRED_EXECUTION_SYMBOLS.has(importedName)) {
            violations.push(`retired canvas.read execution seam import reintroduced: ${relative}::${importedName}`)
          }
        }
      }
      if (
        relative.startsWith('electron/shared/agentCapabilities/') &&
        dependency &&
        forbiddenSharedDependency(dependency)
      ) {
        violations.push(`shared capability has forbidden dependency ${dependency} (${relative})`)
      }
    }

    if (ts.isCallExpression(node) && relative.startsWith('electron/shared/agentCapabilities/')) {
      const expression = accessPath(node.expression, sourceFile)
      const dependency = node.arguments.length === 1 ? constants.string(node.arguments[0]) : null
      if (
        (expression === 'require' || node.expression.kind === ts.SyntaxKind.ImportKeyword) &&
        dependency &&
        forbiddenSharedDependency(dependency)
      ) {
        violations.push(`shared capability has forbidden dependency ${dependency} (${relative})`)
      }
    }

    if (
      relative.startsWith('electron/shared/agentCapabilities/') &&
      ts.isIdentifier(node) &&
      (node.text === 'process' || node.text === 'Buffer')
    ) {
      violations.push(`shared capability has forbidden global ${node.text} (${relative})`)
    }

    if (ts.isBinaryExpression(node)) {
      const capabilityReference =
        canonicalCapabilityReference(node.left, constants, sourceFile) ??
        canonicalCapabilityReference(node.right, constants, sourceFile)
      const comparison =
        node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken ||
        node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
        node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken
      if (capabilityReference && comparison) {
        const guardedFunction = enclosingFunction(node)
        if (guardedFunction && containsCall(guardedFunction) && !isAttestedCanonicalControlFlow(node, relative)) {
          businessSwitches.push(enclosingFunctionName(node, sourceFile) ?? '<anonymous>')
        }
      }
    }

    if (ts.isNewExpression(node) && accessPath(node.expression, sourceFile) === 'Map') {
      const entries = unwrap(node.arguments?.[0])
      if (entries && ts.isArrayLiteralExpression(entries)) {
        for (const candidate of entries.elements) {
          const pair = unwrap(candidate)
          if (
            pair &&
            ts.isArrayLiteralExpression(pair) &&
            canonicalCapabilityReference(pair.elements[0], constants, sourceFile)
          ) {
            businessSwitches.push(variableName(node) ?? '<anonymous Map>')
          }
        }
      }
    }

    if (
      ts.isCaseClause(node) &&
      canonicalCapabilityReference(node.expression, constants, sourceFile) &&
      node.statements.some(containsCall)
    ) {
      businessSwitches.push(enclosingFunctionName(node, sourceFile) ?? '<anonymous switch>')
    }

    if (
      ts.isPropertyAssignment(node) &&
      ts.isComputedPropertyName(node.name) &&
      canonicalCapabilityReference(node.name.expression, constants, sourceFile)
    ) {
      const value = unwrap(node.initializer)
      if (value && (ts.isArrowFunction(value) || ts.isFunctionExpression(value))) {
        businessSwitches.push(variableName(node) ?? '<anonymous object>')
      }
    }

    if (ts.isCaseClause(node) && constants.string(node.expression) === 'canvas.read') {
      violations.push(`second tool-name business switch for canvas.read (${relative})`)
    }

    const literal = constants.string(node)
    if (
      (literal === 'read_canvas_state' || literal === 'nomi_read_canvas') &&
      !canonicalLiteralNodes.has(unwrap(node))
    ) {
      const migratedLocation =
        relative.endsWith('/canvasDescriptors.ts') ||
        relative.endsWith('/mcpToolCatalog.ts') ||
        relative.endsWith('/mcpProtocol.ts') ||
        relative.endsWith('/gate.ts')
      violations.push(
        migratedLocation
          ? `legacy literal ${literal} reintroduced in ${relative}`
          : `alias collision for ${literal} in ${relative}`,
      )
    }

    if (literal === 'canvas.read' && !canonicalLiteralNodes.has(unwrap(node)) && !ts.isCaseClause(node.parent)) {
      violations.push(`duplicate canvas.read id owner or tool-name business switch in ${relative}`)
    }
    if ((ts.isIdentifier(node) && node.text === 'read_canvas') || literal === 'read_canvas') {
      violations.push(`retired canvas.read execution seam reintroduced: ${relative}::read_canvas identifier`)
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  const rendererSeams = facts.filter((value) => value.role === 'renderer_environment_execution_seam')
  if (businessSwitches.length > 0 && rendererSeams.length === 0) {
    for (const symbol of businessSwitches) {
      violations.push(`second tool-name business switch or canvas.read executor: ${relative}::${symbol}`)
    }
  } else if (businessSwitches.length > 1) {
    violations.push(`second tool-name business switch or canvas.read executor in renderer seam ${relative}`)
  }
  return {
    facts,
    violations,
    mcpSafeExposureSites,
    mcpAdapterAttestations,
    mcpTransportAdapterAttestations,
    canonicalExecutionAttestations,
  }
}

export function scanRepository(repoRoot) {
  const facts = []
  const violations = []
  const mcpSafeExposureSites = []
  const mcpAdapterAttestations = []
  const mcpTransportAdapterAttestations = []
  const canonicalExecutionAttestations = []
  for (const root of ['src', 'electron']) {
    for (const file of walk(path.join(repoRoot, root))) {
      const result = scanFile(repoRoot, file)
      facts.push(...result.facts)
      violations.push(...result.violations)
      mcpSafeExposureSites.push(...result.mcpSafeExposureSites)
      mcpAdapterAttestations.push(...result.mcpAdapterAttestations)
      mcpTransportAdapterAttestations.push(...result.mcpTransportAdapterAttestations)
      canonicalExecutionAttestations.push(...result.canonicalExecutionAttestations)
    }
  }
  for (const site of REQUIRED_CANONICAL_EXECUTION_SITES) {
    const matches = canonicalExecutionAttestations.filter((attestation) => attestation.site === site)
    if (matches.length !== 1) violations.push(`canonical canvas.read execution path ${site} must exist exactly once`)
  }
  if (mcpSafeExposureSites.length > 0) {
    const adapter = mcpAdapterAttestations[0]
    if (!adapter) {
      violations.push(`mcp_safe canvas.read exposure requires exact ${CANONICAL_MCP_ADAPTER_SYMBOL}`)
    } else {
      if (!adapter.projectSession) violations.push(`mcp_safe canvas.read requires project_session authority`)
      if (!adapter.routeFree) violations.push(`mcp_safe canvas.read must not attest a retired dispatcher route`)
      if (!adapter.canonicalScope) violations.push(`mcp_safe canvas.read requires canonical requiredScope binding`)
      if (!adapter.leaseRequired) violations.push(`mcp_safe canvas.read requires leaseHandle in required wire fields`)
    }
    const transport = mcpTransportAdapterAttestations[0]
    if (mcpTransportAdapterAttestations.length !== 1 || !transport) {
      violations.push(`mcp_safe canvas.read requires exact ${CANONICAL_MCP_TRANSPORT_ADAPTER_SYMBOL}`)
    } else {
      if (!transport.verifiedFactory) violations.push(`MCP canvas.read transport must mint a verified invocation`)
      if (!transport.executor) violations.push(`MCP canvas.read transport must call the main executor registry`)
    }
  }
  facts.sort((left, right) => entryKey(left).localeCompare(entryKey(right)))
  const dedupedFacts = [...new Map(facts.map((value) => [entryKey(value), value])).values()]
  return { facts: dedupedFacts, violations: [...new Set(violations)] }
}

function renderFailure(message) {
  console.error(`  - ${message}`)
}

export function run({ repoRoot, baselinePath, referenceBaselinePath = null, environment = process.env }) {
  if (!fs.existsSync(baselinePath)) {
    console.error(`✖ capability owner baseline is missing: ${baselinePath}`)
    return 1
  }
  let baseline
  try {
    baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
  } catch (error) {
    console.error(
      `✖ capability owner baseline is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
    return 1
  }
  const failures = validateBaseline(baseline)
  if (!Array.isArray(baseline?.entries)) {
    console.error('✖ canvas.read capability owner gate failed:')
    for (const failure of failures) renderFailure(failure)
    return 1
  }
  failures.push(...currentCutoverFailures(baseline))
  const { facts, violations } = scanRepository(repoRoot)
  const factByKey = new Map(facts.map((value) => [entryKey(value), value]))
  const baselineByKey = new Map(baseline.entries.map((value) => [entryKey(value), value]))
  for (const fact of facts) {
    if (!baselineByKey.has(entryKey(fact))) failures.push(`unregistered owner: ${factSite(fact)}`)
  }
  for (const value of baseline.entries) {
    if (!factByKey.has(entryKey(value))) failures.push(`stale or moved owner: ${factSite(value)}`)
  }
  for (const role of CANONICAL_ROLES) {
    const owners = facts.filter((value) => value.role === role)
    if (owners.length !== 1) failures.push(`${role} must have exactly one owner; found ${owners.length}`)
  }
  failures.push(...violations)

  const resolution = resolveReferenceBaselines({
    repoRoot,
    baselinePath,
    referenceBaselinePath,
    environment,
  })
  failures.push(...resolution.errors.map((message) => `historical reference unavailable: ${message}`))
  if (resolution.references.length === 0 && !resolution.seed && resolution.errors.length === 0) {
    failures.push(`historical reference unavailable: ${resolution.seedReason ?? 'no trusted baseline'}`)
  }
  const validReferences = resolution.references.filter((reference) => {
    const referenceFailures = validateBaseline(reference.baseline)
    failures.push(...referenceFailures.map((message) => `invalid historical baseline ${reference.label}: ${message}`))
    return referenceFailures.length === 0
  })
  for (const failure of historicalFailures(facts, baseline, validReferences)) {
    failures.push(`${failure.kind}: ${failure.entry?.site ?? failure.message ?? failure.referenceLabel}`)
  }

  if (failures.length) {
    console.error('✖ canvas.read capability owner gate failed:')
    for (const failure of failures) renderFailure(failure)
    return 1
  }
  console.log(
    `✓ canvas.read capability owners are singular (${facts.length} entries; ${baseline.entries.filter((value) => value.deleteIn).length} Slice B debts).`,
  )
  return 0
}

function main() {
  const argv = process.argv.slice(2)
  const repoRoot = path.resolve(readOption(argv, '--repo-root', process.cwd()))
  const baselinePath = path.resolve(
    readOption(argv, '--baseline', path.join(repoRoot, 'scripts/capability-owners-baseline.json')),
  )
  const reference = readOption(argv, '--reference-baseline', null)
  process.exitCode = run({
    repoRoot,
    baselinePath,
    referenceBaselinePath: reference ? path.resolve(reference) : null,
  })
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main()
