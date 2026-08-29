import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig(
	globalIgnores(["node_modules/**", "esbuild.config.mjs", "main.js", "package-lock.json"]),
	{
		languageOptions: {
			globals: { ...globals.browser },
			parserOptions: {
				projectService: {
					allowDefaultProject: ["eslint.config.mts", "manifest.json", "scripts/*.mjs"],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: [".json"],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		rules: {
			"obsidianmd/settings-tab/prefer-setting-definitions": "off",
		},
	},
	{
		files: ["scripts/*.mjs"],
		rules: {
			"obsidianmd/no-nodejs-modules": "off",
		},
	},
);
