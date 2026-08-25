const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

// Monorepo setup: allow Metro to resolve packages from the workspace root
// (needed for the @chat/shared workspace package and shared hoisted deps).
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.disableHierarchicalLookup = false;
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
