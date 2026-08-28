import ts from 'typescript'
import {
  createStaticResolver,
  staticStringExpression,
  unwrapStaticExpression as unwrap,
} from './check-vocabularies-scan.mjs'
import {
  DIRECT_READ_NAMES,
  EXECUTOR_FILE,
  EXECUTOR_PATH,
  EXPECTED_REGISTRY_MEMBERS,
  REQUIRED_CANONICAL_EXECUTION_SITES,
  TRANSPORT_FILE,
  TRANSPORT_SPECS,
} from './check-capability-owners-execution-contract.mjs'

export { REQUIRED_CANONICAL_EXECUTION_SITES }

const resolverCache = new WeakMap()

function resolverFor(node) {
  const sourceFile = node.getSourceFile()
  let resolver = resolverCache.get(sourceFile)
  if (!resolver) {
    resolver = createStaticResolver(sourceFile)
    resolverCache.set(sourceFile, resolver)
  }
  return resolver
}

function propertyName(node, resolver, resolveAliases = true) {
  if (!node) return null
  if (ts.isComputedPropertyName(node)) {
    return resolveAliases ? resolver.string(node.expression) : staticStringExpression(node.expression)
  }
  return ts.isIdentifier(node) || ts.isPrivateIdentifier(node) || ts.isStringLiteralLike(node) ? node.text : null
}

function pathLike(node) {
  const current = unwrap(node)
  return Boolean(
    current &&
    (ts.isIdentifier(current) || ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)),
  )
}

function accessPath(node, resolver, seen = new Set(), resolveAliases = true) {
  const current = unwrap(node)
  if (!current) return null
  if (ts.isIdentifier(current)) {
    const resolved = resolveAliases ? resolver.expression(current) : current
    if (resolved !== current && pathLike(resolved) && !seen.has(current.text)) {
      const nextSeen = new Set(seen)
      nextSeen.add(current.text)
      return accessPath(resolved, resolver, nextSeen, resolveAliases)
    }
    return current.text
  }
  if (current.kind === ts.SyntaxKind.ThisKeyword) return 'this'
  if (ts.isPropertyAccessExpression(current)) {
    const base = accessPath(current.expression, resolver, seen, resolveAliases)
    const name = propertyName(current.name, resolver, resolveAliases)
    return base && name ? `${base}.${name}` : null
  }
  if (ts.isElementAccessExpression(current)) {
    const base = accessPath(current.expression, resolver, seen, resolveAliases)
    const name = resolveAliases
      ? resolver.string(current.argumentExpression)
      : staticStringExpression(current.argumentExpression)
    return base && name ? `${base}.${name}` : null
  }
  return null
}

function traverse(root, lexical, visitor) {
  function visit(node) {
    if (lexical && node !== root && ts.isFunctionLike(node)) return
    visitor(node)
    ts.forEachChild(node, visit)
  }
  visit(root)
}

function callsIn(root, resolver, lexical = false) {
  const calls = []
  traverse(root, lexical, (node) => {
    if (ts.isCallExpression(node)) calls.push({ node, path: accessPath(node.expression, resolver) })
  })
  return calls
}

function callsAt(calls, path) {
  return calls.filter((call) => call.path === path)
}

function lexicalReturns(root) {
  const returns = []
  traverse(root, true, (node) => {
    if (ts.isReturnStatement(node) && node.expression) returns.push(node)
  })
  return returns
}

function hasConditionalAncestor(node, root) {
  for (let current = node.parent; current && current !== root; current = current.parent) {
    if (
      ts.isIfStatement(current) ||
      ts.isConditionalExpression(current) ||
      ts.isSwitchStatement(current) ||
      ts.isForStatement(current) ||
      ts.isForInStatement(current) ||
      ts.isForOfStatement(current) ||
      ts.isWhileStatement(current) ||
      ts.isDoStatement(current) ||
      (ts.isBinaryExpression(current) &&
        [
          ts.SyntaxKind.AmpersandAmpersandToken,
          ts.SyntaxKind.BarBarToken,
          ts.SyntaxKind.QuestionQuestionToken,
        ].includes(current.operatorToken.kind))
    ) {
      return true
    }
  }
  return false
}

function followsUnconditionalAbruptCompletion(node, root) {
  for (let current = node; current && current !== root; current = current.parent) {
    const parent = current.parent
    if (!parent || (!ts.isBlock(parent) && !ts.isSourceFile(parent))) continue
    const statementIndex = parent.statements.findIndex((statement) => statement === current)
    if (statementIndex < 0) continue
    if (
      parent.statements
        .slice(0, statementIndex)
        .some((statement) => ts.isReturnStatement(statement) || ts.isThrowStatement(statement))
    ) {
      return true
    }
  }
  return false
}

function positiveEvidenceIsNonLinear(node, root) {
  return hasConditionalAncestor(node, root) || followsUnconditionalAbruptCompletion(node, root)
}

function objectFromExpression(expression, resolver) {
  let current = unwrapValue(expression)
  if (
    current &&
    ts.isCallExpression(current) &&
    accessPath(current.expression, resolver) === 'Object.freeze' &&
    current.arguments.length === 1
  ) {
    current = unwrapValue(current.arguments[0])
  }
  return current && ts.isObjectLiteralExpression(current) ? current : null
}

function memberExpression(object, name, resolver) {
  const members = returnedMember(object, name, resolver)
  if (members.length !== 1) return null
  const member = members[0]
  if (ts.isPropertyAssignment(member)) return member.initializer
  if (ts.isShorthandPropertyAssignment(member)) return member.name
  return null
}

function isTrueExpression(expression) {
  return unwrapValue(expression)?.kind === ts.SyntaxKind.TrueKeyword
}

function directReturnedObjects(factory, resolver) {
  const objects = []
  for (const statement of lexicalReturns(factory)) {
    let returned = unwrap(statement.expression)
    if (
      returned &&
      ts.isCallExpression(returned) &&
      accessPath(returned.expression, resolver) === 'Object.freeze' &&
      returned.arguments.length === 1
    ) {
      returned = unwrap(returned.arguments[0])
    }
    if (returned && ts.isObjectLiteralExpression(returned)) objects.push(returned)
  }
  return objects
}

function returnedMember(object, name, resolver) {
  return object.properties.filter((property) => 'name' in property && propertyName(property.name, resolver) === name)
}

function directVariable(factory, name) {
  const matches = []
  traverse(factory, true, (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) matches.push(node)
  })
  return matches
}

function referencePaths(root, resolver, resolveAliases) {
  const paths = []
  traverse(root, false, (node) => {
    if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      paths.push(accessPath(node, resolver, new Set(), resolveAliases))
    } else if (ts.isVariableDeclaration(node) && node.initializer) {
      paths.push(accessPath(node.initializer, resolver, new Set(), resolveAliases))
    } else if (ts.isPropertyAssignment(node)) {
      paths.push(accessPath(node.initializer, resolver, new Set(), resolveAliases))
    } else if (ts.isShorthandPropertyAssignment(node)) {
      paths.push(accessPath(node.name, resolver, new Set(), resolveAliases))
    } else if (ts.isReturnStatement(node) && node.expression) {
      paths.push(accessPath(node.expression, resolver, new Set(), resolveAliases))
    }
  })
  return paths.filter(Boolean)
}

function referenceNodesAt(root, resolver, path) {
  const references = new Set()
  traverse(root, false, (node) => {
    if (!ts.isIdentifier(node) && !ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) {
      return
    }
    const raw = accessPath(node, resolver, new Set(), false)
    const resolved = accessPath(node, resolver)
    if (raw === path || resolved === path) references.add(node)
  })
  return [...references]
}

function exactDirectRoute(root, resolver, path) {
  const calls = callsAt(callsIn(root, resolver), path)
  const references = referenceNodesAt(root, resolver, path)
  return {
    calls,
    references,
    valid: calls.length === 1 && references.length === 1 && unwrapValue(calls[0].node.expression) === references[0],
  }
}

function exactExecutorRoute(root, resolver) {
  const route = exactDirectRoute(root, resolver, EXECUTOR_PATH)
  const executorReceivers = referenceNodesAt(root, resolver, 'input.executor')
  const methodReference = route.references[0]
  const methodReceiver =
    methodReference && (ts.isPropertyAccessExpression(methodReference) || ts.isElementAccessExpression(methodReference))
      ? unwrapValue(methodReference.expression)
      : null
  return {
    ...route,
    valid: route.valid && executorReceivers.length === 1 && methodReceiver === executorReceivers[0],
  }
}

function directReadSinks(root, resolver) {
  const paths = [...referencePaths(root, resolver, false), ...referencePaths(root, resolver, true)]
  return [...new Set(paths)].filter((path) => {
    const name = path.split('.').at(-1)
    return DIRECT_READ_NAMES.has(name) || path.includes('useGenerationCanvasStore.getState')
  })
}

function canonicalStructureViolations(root, site, resolver) {
  const violations = directReadSinks(root, resolver).map(
    (sink) => `direct canvas read sink in canonical execution path ${site}: ${sink}`,
  )
  let hasBindingElement = false
  traverse(root, false, (node) => {
    if (ts.isBindingElement(node)) hasBindingElement = true
  })
  if (hasBindingElement) {
    violations.push(`canonical canvas.read execution path ${site} cannot destructure capability-bearing inputs`)
  }
  return violations
}

function unwrapValue(node) {
  let current = unwrap(node)
  while (current && (ts.isAwaitExpression(current) || ts.isNonNullExpression(current))) {
    current = unwrap(current.expression)
  }
  return current
}

function bindingExpression(root, name, before) {
  let expression = null
  let latest = -1
  const beforePosition = before.getStart()
  traverse(root, true, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer &&
      node.getStart() < beforePosition &&
      node.getStart() > latest
    ) {
      expression = node.initializer
      latest = node.getStart()
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(unwrap(node.left)) &&
      unwrap(node.left).text === name &&
      node.getStart() < beforePosition &&
      node.getStart() > latest
    ) {
      expression = node.right
      latest = node.getStart()
    }
  })
  return expression
}

function directlyDerivedFromCall(expression, call, root, seen = new Set()) {
  const current = unwrapValue(expression)
  if (!current) return false
  if (current === call.node) return true
  if (!ts.isIdentifier(current) || seen.has(current.text)) return false
  const binding = bindingExpression(root, current.text, current)
  if (!binding) return false
  const nextSeen = new Set(seen)
  nextSeen.add(current.text)
  return directlyDerivedFromCall(binding, call, root, nextSeen)
}

function bindingNameFromCall(root, call) {
  let binding = null
  let latest = -1
  traverse(root, true, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      directlyDerivedFromCall(node.initializer, call, root) &&
      node.getStart() > latest
    ) {
      binding = node.name.text
      latest = node.getStart()
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(unwrap(node.left)) &&
      directlyDerivedFromCall(node.right, call, root) &&
      node.getStart() > latest
    ) {
      binding = unwrap(node.left).text
      latest = node.getStart()
    }
  })
  return binding
}

function directlyReturnedCall(root, call) {
  return lexicalReturns(root).some((statement) => directlyDerivedFromCall(statement.expression, call, root))
}

function identifierName(node) {
  const current = unwrapValue(node)
  return current && ts.isIdentifier(current) ? current.text : null
}

function invocationFlowViolations(fn, site, spec, resolver, requireReturnedExecutor) {
  const lexicalCalls = callsIn(fn, resolver, true)
  const fullCalls = callsIn(fn, resolver)
  const mintCalls = callsAt(lexicalCalls, spec.mintPath)
  const executorCalls = callsAt(lexicalCalls, EXECUTOR_PATH)
  const violations = []
  if (mintCalls.length !== 1 || callsAt(fullCalls, spec.mintPath).length !== 1) {
    violations.push(`canonical canvas.read execution path ${site} must mint exactly once on its live lexical path`)
  }
  if (executorCalls.length !== 1 || callsAt(fullCalls, EXECUTOR_PATH).length !== 1) {
    violations.push(`canonical canvas.read execution path ${site} must execute exactly once on its live lexical path`)
  }
  if (mintCalls.length === 1 && executorCalls.length === 1) {
    const argument = executorCalls[0].node.arguments[0]
    const derivesFromMint = Boolean(argument && directlyDerivedFromCall(argument, mintCalls[0], fn))
    if (!derivesFromMint) {
      violations.push(`canonical canvas.read execution path ${site} must pass the minted invocation to the executor`)
    }
    if (requireReturnedExecutor && !directlyReturnedCall(fn, executorCalls[0])) {
      violations.push(`canonical canvas.read execution path ${site} must return its registry executor result`)
    }
    if (positiveEvidenceIsNonLinear(mintCalls[0].node, fn) || positiveEvidenceIsNonLinear(executorCalls[0].node, fn)) {
      violations.push(`canonical canvas.read execution path ${site} mint-to-executor route must be unconditional`)
    }
  }
  return violations
}

function returnedNull(statement) {
  const candidate = ts.isBlock(statement) && statement.statements.length === 1 ? statement.statements[0] : statement
  return ts.isReturnStatement(candidate) && candidate.expression?.kind === ts.SyntaxKind.NullKeyword
}

function hasDominatingPiGuard(method, resolver, executorCall) {
  const guard = method.body?.statements[0]
  if (!guard || !ts.isIfStatement(guard) || guard.elseStatement || !returnedNull(guard.thenStatement)) return false
  const condition = unwrap(guard.expression)
  if (
    !condition ||
    !ts.isBinaryExpression(condition) ||
    ![ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(
      condition.operatorToken.kind,
    )
  ) {
    return false
  }
  const compared = [accessPath(condition.left, resolver), accessPath(condition.right, resolver)].sort()
  return (
    compared[0] === 'CANVAS_READ_CAPABILITY.aliases.pi' &&
    compared[1] === 'call.toolName' &&
    executorCall.node.getStart() > guard.end
  )
}

function hasDominatingTransportGuard(method, resolver, executeCall) {
  const guard = method.body?.statements[0]
  if (!guard || !ts.isIfStatement(guard) || guard.elseStatement) return false
  const condition = unwrapValue(guard.expression)
  const returned =
    ts.isBlock(guard.thenStatement) && guard.thenStatement.statements.length === 1
      ? guard.thenStatement.statements[0]
      : guard.thenStatement
  if (
    !condition ||
    !ts.isPrefixUnaryExpression(condition) ||
    condition.operator !== ts.SyntaxKind.ExclamationToken ||
    !ts.isCallExpression(unwrapValue(condition.operand)) ||
    accessPath(unwrapValue(condition.operand).expression, resolver) !== 'isCanvasReadTransportMethod' ||
    !ts.isReturnStatement(returned) ||
    identifierName(returned.expression) !== 'NOT_HANDLED'
  ) {
    return false
  }
  return executeCall.node.getStart() > guard.end && !positiveEvidenceIsNonLinear(executeCall.node, method)
}

function returnedHandledResult(method, executeCall, resolver) {
  return lexicalReturns(method).some((statement) => {
    const object = objectFromExpression(statement.expression, resolver)
    if (!object) return false
    const handled = memberExpression(object, 'handled', resolver)
    const result = memberExpression(object, 'result', resolver)
    return Boolean(
      handled &&
      isTrueExpression(handled) &&
      result &&
      directlyDerivedFromCall(result, executeCall, method) &&
      !positiveEvidenceIsNonLinear(statement, method),
    )
  })
}

function returnedPiSuccess(method, executorCall, resolver) {
  const resultBinding = bindingNameFromCall(method, executorCall)
  if (!resultBinding) return directlyReturnedCall(method, executorCall)
  return lexicalReturns(method).some((statement) => {
    const object = objectFromExpression(statement.expression, resolver)
    if (!object) return false
    const ok = memberExpression(object, 'ok', resolver)
    const result = memberExpression(object, 'result', resolver)
    if (!ok || !isTrueExpression(ok) || !result) return false
    const formatCalls = callsAt(callsIn(result, resolver), 'formatCanvasForAgent')
    return Boolean(
      formatCalls.length === 1 &&
      formatCalls[0].node.arguments[0] &&
      directlyDerivedFromCall(formatCalls[0].node.arguments[0], executorCall, method) &&
      !positiveEvidenceIsNonLinear(statement, method),
    )
  })
}

function inspectTransport(factory, site, spec) {
  const resolver = resolverFor(factory)
  const violations = canonicalStructureViolations(factory, site, resolver)
  if (spec.creatorPath) {
    const creatorRoute = exactDirectRoute(factory, resolver, spec.creatorPath)
    const creatorCall = creatorRoute.calls[0]
    const factoryDeclarations = directVariable(factory, 'factory')
    const factoryDeclaration = factoryDeclarations[0]
    if (
      !creatorRoute.valid ||
      !creatorCall ||
      factoryDeclarations.length !== 1 ||
      !factoryDeclaration?.initializer ||
      !directlyDerivedFromCall(factoryDeclaration.initializer, creatorCall, factory) ||
      positiveEvidenceIsNonLinear(creatorCall.node, factory)
    ) {
      violations.push(`canonical canvas.read execution path ${site} must bind its verified invocation factory once`)
    }
  }
  const mintRoute = exactDirectRoute(factory, resolver, spec.mintPath)
  const executorRoute = exactExecutorRoute(factory, resolver)
  if (!mintRoute.valid || !executorRoute.valid) {
    violations.push(`canonical canvas.read execution path ${site} must expose exactly one mint-to-executor route`)
  }

  const returnedObjects = directReturnedObjects(factory, resolver)
  const object = returnedObjects[0]
  if (returnedObjects.length !== 1 || !object) {
    violations.push(`canonical canvas.read execution path ${site} must return exactly one frozen adapter object`)
    return { site, valid: false, violations }
  }
  const keys = object.properties
    .map((property) => ('name' in property ? propertyName(property.name, resolver) : null))
    .sort()
  if (
    keys.some((key) => key === null) ||
    keys.length !== spec.returnedKeys.length ||
    keys.some((key, index) => key !== spec.returnedKeys[index])
  ) {
    violations.push(`canonical canvas.read execution path ${site} returned adapter member schema changed`)
  }

  const tryMembers = returnedMember(object, 'tryExecute', resolver)
  const tryExecute = tryMembers.length === 1 && ts.isMethodDeclaration(tryMembers[0]) ? tryMembers[0] : null
  if (!tryExecute) {
    violations.push(`canonical canvas.read execution path ${site} must expose one direct tryExecute method`)
  }

  if (spec.mode === 'delegated') {
    const executeMembers = returnedMember(object, 'execute', resolver)
    const executeDeclarations = directVariable(factory, 'execute')
    const executeDeclaration = executeDeclarations[0]
    const executeFunction = executeDeclaration ? unwrap(executeDeclaration.initializer) : null
    if (
      executeMembers.length !== 1 ||
      !ts.isShorthandPropertyAssignment(executeMembers[0]) ||
      executeDeclarations.length !== 1 ||
      !executeFunction ||
      (!ts.isArrowFunction(executeFunction) && !ts.isFunctionExpression(executeFunction))
    ) {
      violations.push(`canonical canvas.read execution path ${site} must return its one local execute delegate`)
    } else {
      violations.push(...invocationFlowViolations(executeFunction, site, spec, resolver, true))
    }
    if (tryExecute) {
      const wrapperCalls = callsIn(tryExecute, resolver, true)
      const executeCalls = callsAt(wrapperCalls, 'execute')
      if (
        callsAt(wrapperCalls, 'isCanvasReadTransportMethod').length !== 1 ||
        executeCalls.length !== 1 ||
        !hasDominatingTransportGuard(tryExecute, resolver, executeCalls[0]) ||
        !returnedHandledResult(tryExecute, executeCalls[0], resolver)
      ) {
        violations.push(
          `canonical canvas.read execution path ${site} tryExecute must guard and project its local delegate`,
        )
      }
    }
  } else {
    const disposeMembers = returnedMember(object, 'dispose', resolver)
    if (disposeMembers.length !== 1 || !ts.isMethodDeclaration(disposeMembers[0])) {
      violations.push(`canonical canvas.read execution path ${site} must expose one direct dispose method`)
    }
    if (tryExecute) {
      const executorCalls = callsAt(callsIn(tryExecute, resolver, true), EXECUTOR_PATH)
      if (executorCalls.length !== 1 || !hasDominatingPiGuard(tryExecute, resolver, executorCalls[0])) {
        violations.push(`canonical canvas.read execution path ${site} must have one dominating canonical Pi guard`)
      }
      violations.push(...invocationFlowViolations(tryExecute, site, spec, resolver, false))
      if (executorCalls.length === 1 && !returnedPiSuccess(tryExecute, executorCalls[0], resolver)) {
        violations.push(`canonical canvas.read execution path ${site} must return its executor-derived success result`)
      }
    }
  }
  return { site, valid: violations.length === 0, violations }
}

function registryDeclaration(node, relative) {
  return (
    relative === EXECUTOR_FILE &&
    ts.isMethodDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.name.text === 'execute' &&
    ts.isClassDeclaration(node.parent) &&
    node.parent.name?.text === 'CapabilityExecutorRegistry'
  )
}

function registryMemberSignature(member, resolver) {
  if (ts.isConstructorDeclaration(member)) return 'constructor'
  if (ts.isMethodDeclaration(member)) return `method:${propertyName(member.name, resolver)}`
  if (ts.isPropertyDeclaration(member)) return `property:${propertyName(member.name, resolver)}`
  return `unsupported:${ts.SyntaxKind[member.kind]}`
}

function exactReturnedCall(root, call) {
  return lexicalReturns(root).some((statement) => {
    let expression = unwrap(statement.expression)
    if (expression && ts.isAwaitExpression(expression)) expression = unwrap(expression.expression)
    return expression === call.node
  })
}

function callArgumentIs(call, index, name) {
  return Boolean(call && identifierName(call.node.arguments[index]) === name)
}

function callsAreOrdered(calls) {
  return calls.every((call, index) => index === 0 || calls[index - 1].node.getStart() < call.node.getStart())
}

function returnedByBoundedRecipe(bounded, executeCall, resolver) {
  const returns = lexicalReturns(bounded)
  if (returns.length !== 1 || positiveEvidenceIsNonLinear(executeCall.node, bounded)) return false
  if (directlyDerivedFromCall(returns[0].expression, executeCall, bounded)) return true

  const returned = unwrapValue(returns[0].expression)
  if (!returned || !ts.isCallExpression(returned) || accessPath(returned.expression, resolver) !== 'Promise.race') {
    return false
  }
  const candidates = unwrapValue(returned.arguments[0])
  return Boolean(
    candidates &&
    ts.isArrayLiteralExpression(candidates) &&
    candidates.elements.filter((element) => unwrapValue(element) === executeCall.node).length === 1,
  )
}

function boundedHelperIsLive(method, resolver) {
  const declarations = method
    .getSourceFile()
    .statements.filter(
      (statement) =>
        ts.isFunctionDeclaration(statement) && statement.name?.text === 'bounded' && statement.parameters.length >= 3,
    )
  const bounded = declarations[0]
  if (declarations.length !== 1 || !bounded || identifierName(bounded.parameters[2].name) !== 'execute') return false
  const executeCalls = callsAt(callsIn(bounded, resolver, true), 'execute')
  return (
    executeCalls.length === 1 &&
    callsAt(callsIn(bounded, resolver), 'execute').length === 1 &&
    returnedByBoundedRecipe(bounded, executeCalls[0], resolver)
  )
}

function inspectRegistry(method) {
  const site = 'CapabilityExecutorRegistry.execute'
  const resolver = resolverFor(method)
  const registry = method.parent
  const violations = canonicalStructureViolations(registry, site, resolver)
  const members = registry.members.map((member) => registryMemberSignature(member, resolver)).sort()
  if (
    members.length !== EXPECTED_REGISTRY_MEMBERS.length ||
    members.some((member, index) => member !== EXPECTED_REGISTRY_MEMBERS[index])
  ) {
    violations.push(`canonical canvas.read execution path ${site} public class member schema changed`)
  }
  if (!boundedHelperIsLive(method, resolver)) {
    violations.push(`canonical canvas.read execution path ${site} bounded helper must return its live callback`)
  }

  const outerCalls = callsIn(method, resolver, true)
  const boundedCalls = callsAt(outerCalls, 'bounded')
  for (const [path, expected] of [
    ['assertVerifiedCapabilityInvocation', 1],
    ['parseInput', 1],
    ['bounded', 1],
  ]) {
    if (callsAt(outerCalls, path).length !== expected) {
      violations.push(`canonical canvas.read execution path ${site} must call ${path} exactly ${expected} time(s)`)
    }
  }
  const invocationDeclarations = directVariable(method, 'invocation')
  const invocation = invocationDeclarations[0]
  const assertCall = callsAt(outerCalls, 'assertVerifiedCapabilityInvocation')[0]
  const parseCall = callsAt(outerCalls, 'parseInput')[0]
  if (
    invocationDeclarations.length !== 1 ||
    !invocation ||
    identifierName(invocation.initializer) !== 'invocationValue' ||
    !callArgumentIs(assertCall, 0, 'invocationValue') ||
    !callArgumentIs(parseCall, 0, 'invocation') ||
    !callsAreOrdered([assertCall, parseCall, boundedCalls[0]].filter(Boolean)) ||
    [assertCall, parseCall, boundedCalls[0]]
      .filter(Boolean)
      .some((call) => positiveEvidenceIsNonLinear(call.node, method))
  ) {
    violations.push(`canonical canvas.read execution path ${site} must validate and parse the same invocation in order`)
  }
  const boundedCall = boundedCalls[0]
  const callback = boundedCall ? unwrap(boundedCall.node.arguments[2]) : null
  if (
    !boundedCall ||
    lexicalReturns(method).length !== 1 ||
    !exactReturnedCall(method, boundedCall) ||
    !callback ||
    !ts.isArrowFunction(callback)
  ) {
    violations.push(`canonical canvas.read execution path ${site} must return one bounded live executor callback`)
    return { site, valid: false, violations }
  }

  const callbackCalls = callsIn(callback, resolver, true)
  for (const [path, expected] of [
    ['revalidate', 3],
    ['this.#resolveCanvasReadPort', 1],
    ['port.read', 1],
    ['projectOutput', 1],
  ]) {
    if (callsAt(callbackCalls, path).length !== expected) {
      violations.push(
        `canonical canvas.read execution path ${site} live callback must call ${path} ${expected} time(s)`,
      )
    }
  }

  const revalidateCalls = callsAt(callbackCalls, 'revalidate')
  const resolverCall = callsAt(callbackCalls, 'this.#resolveCanvasReadPort')[0]
  const readCall = callsAt(callbackCalls, 'port.read')[0]
  const projectorCall = callsAt(callbackCalls, 'projectOutput')[0]
  const orderedLiveCalls = [
    revalidateCalls[0],
    resolverCall,
    revalidateCalls[1],
    readCall,
    revalidateCalls[2],
    projectorCall,
  ]
  if (
    revalidateCalls.some((call) => !callArgumentIs(call, 0, 'invocation')) ||
    !callArgumentIs(resolverCall, 0, 'invocation') ||
    orderedLiveCalls.some((call) => !call) ||
    !callsAreOrdered(orderedLiveCalls.filter(Boolean)) ||
    orderedLiveCalls.filter(Boolean).some((call) => positiveEvidenceIsNonLinear(call.node, callback))
  ) {
    violations.push(
      `canonical canvas.read execution path ${site} must revalidate one invocation around resolve and read`,
    )
  }
  if (resolverCall && readCall && projectorCall) {
    const portBinding = bindingNameFromCall(callback, resolverCall)
    const readReceiver = ts.isPropertyAccessExpression(readCall.node.expression)
      ? identifierName(readCall.node.expression.expression)
      : null
    const projectedArgument = projectorCall.node.arguments[0]
    if (
      !portBinding ||
      readReceiver !== portBinding ||
      !projectedArgument ||
      !directlyDerivedFromCall(projectedArgument, readCall, callback) ||
      lexicalReturns(callback).length !== 1 ||
      !exactReturnedCall(callback, projectorCall)
    ) {
      violations.push(
        `canonical canvas.read execution path ${site} must return projectOutput of its live port.read result`,
      )
    }
  }
  return { site, valid: violations.length === 0, violations }
}

function transportDeclaration(node, relative) {
  return (
    relative === TRANSPORT_FILE && ts.isFunctionDeclaration(node) && node.name && TRANSPORT_SPECS.has(node.name.text)
  )
}

export function inspectCanonicalExecutionDeclaration(node, relative) {
  if (registryDeclaration(node, relative)) return inspectRegistry(node)
  if (transportDeclaration(node, relative)) {
    return inspectTransport(node, node.name.text, TRANSPORT_SPECS.get(node.name.text))
  }
  return null
}

export function isAttestedCanonicalControlFlow(node, relative) {
  let nearestFunction = node.parent
  while (nearestFunction && !ts.isFunctionLike(nearestFunction)) nearestFunction = nearestFunction.parent
  if (!nearestFunction) return false

  const directAttestation = inspectCanonicalExecutionDeclaration(nearestFunction, relative)
  if (directAttestation) return directAttestation.valid
  if (
    !ts.isMethodDeclaration(nearestFunction) ||
    propertyName(nearestFunction.name, resolverFor(node)) !== 'tryExecute'
  ) {
    return false
  }
  for (let current = nearestFunction.parent; current; current = current.parent) {
    if (!transportDeclaration(current, relative)) continue
    const spec = TRANSPORT_SPECS.get(current.name.text)
    if (spec.mode !== 'pi') return false
    const resolver = resolverFor(current)
    const returnedObjects = directReturnedObjects(current, resolver)
    const tryMembers = returnedObjects.length === 1 ? returnedMember(returnedObjects[0], 'tryExecute', resolver) : []
    const attestation = inspectCanonicalExecutionDeclaration(current, relative)
    return Boolean(attestation?.valid && tryMembers.length === 1 && tryMembers[0] === nearestFunction)
  }
  return false
}
