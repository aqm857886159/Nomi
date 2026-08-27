import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
// These are execution boundaries, not a grandfathered list of app callers.
const EXPLICIT_BOUNDARIES = new Set([
  'electron/appFetch.ts', // injects the app-owned dispatcher into native fetch
  'electron/harness/runtime/pi/run.mts', // isolated SDK adapter; host always injects appFetch
  'electron/harness/runtime/pi/model.mts', // standalone SDK model tests; normal runtime injects fetch
  'electron/capabilityCore/mcpNodeLauncher.ts', // pure Node CLI -> authenticated localhost RPC only
]);
const CLIENT_METHODS = new Map([
  ['undici', new Set(['fetch', 'request', 'pipeline', 'stream', 'connect', 'dispatch'])],
  ...['http', 'https', 'node:http', 'node:https'].map((module) => [module, new Set(['request', 'get'])]),
]);

function requiredModule(node) {
  if (ts.isAwaitExpression(node)) return requiredModule(node.expression);
  if (!ts.isCallExpression(node) || !node.arguments[0] || !ts.isStringLiteral(node.arguments[0])) return undefined;
  return (ts.isIdentifier(node.expression) && node.expression.text === 'require')
    || node.expression.kind === ts.SyntaxKind.ImportKeyword ? node.arguments[0].text : undefined;
}

function inType(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isTypeNode(parent)) return true;
    if (ts.isStatement(parent) || ts.isExpression(parent)) return false;
  }
  return false;
}

export function networkEntryViolations(file, source) {
  if (EXPLICIT_BOUNDARIES.has(file)) return [];
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const violations = [];
  const clients = new Map();
  const record = (node, message) => {
    const { line } = ast.getLineAndCharacterOfPosition(node.getStart(ast));
    violations.push(`${file}:${line + 1}: ${message}`);
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && !node.importClause?.isTypeOnly) {
      const module = node.moduleSpecifier.text;
      const methods = CLIENT_METHODS.get(module);
      if (methods) {
        if (node.importClause?.name) clients.set(node.importClause.name.text, module);
        const bindings = node.importClause?.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) clients.set(bindings.name.text, module);
        if (bindings && ts.isNamedImports(bindings)) for (const binding of bindings.elements) {
          if (!binding.isTypeOnly && methods.has((binding.propertyName ?? binding.name).text)) {
            record(binding, 'raw Node HTTP client import bypasses appFetch');
          }
        }
      }
    }
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const module = requiredModule(node.initializer);
      const methods = CLIENT_METHODS.get(module);
      if (methods && ts.isIdentifier(node.name)) clients.set(node.name.text, module);
      if (methods && ts.isObjectBindingPattern(node.name)) for (const binding of node.name.elements) {
        if (methods.has((binding.propertyName ?? binding.name).getText(ast))) record(binding, 'raw Node HTTP client require bypasses appFetch');
      }
    }
    if (ts.isIdentifier(node) && node.text === 'fetch' && !inType(node)) {
      const parent = node.parent;
      const propertyName = (ts.isPropertyAccessExpression(parent) || ts.isPropertyAssignment(parent)
        || ts.isMethodDeclaration(parent) || ts.isPropertySignature(parent)) && parent.name === node;
      if (!propertyName) record(node, 'Node fetch must use appFetch (or an explicitly injected fetchImpl)');
    }
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'fetch'
      && ts.isIdentifier(node.expression) && node.expression.text === 'globalThis' && !inType(node)) {
      record(node, 'globalThis.fetch bypasses the app transport');
    }
    if (ts.isPropertyAccessExpression(node) && !inType(node)) {
      const module = ts.isIdentifier(node.expression) ? clients.get(node.expression.text) : requiredModule(node.expression);
      if (CLIENT_METHODS.get(module)?.has(node.name.text)) record(node, 'raw Node HTTP client bypasses appFetch');
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'WebSocket') {
      const options = node.arguments?.[1];
      if (!options || !ts.isObjectLiteralExpression(options)
        || !options.properties.some((property) => property.name?.getText(ast) === 'dispatcher')) {
        record(node, 'main-process WebSocket needs the app-owned dispatcher');
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return violations;
}

export function checkNetworkEntries(directory = root) {
  const violations = [];
  function walk(folder) {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(?:ts|mts|cts)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
        violations.push(...networkEntryViolations(path.relative(directory, full).split(path.sep).join('/'), readFileSync(full, 'utf8')));
      }
    }
  }
  walk(path.join(directory, 'electron'));
  return violations;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const violations = checkNetworkEntries();
  for (const violation of violations) console.error(violation);
  console.log(`network-entry: ${violations.length} unowned Node network entry(s)`);
  process.exitCode = violations.length ? 1 : 0;
}
