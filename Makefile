# FlagLens: self-hosted Flagsmith dev kit + VS Code extension.
# Every target has an npm equivalent for machines without make (see package.json "scripts").

COMPOSE := docker compose -f devkit/compose.yaml
VSIX    := extension/flaglens.vsix

.DEFAULT_GOAL := help
.PHONY: help up seed down reset logs mcp demo install ext package install-ext test lint typecheck check verify-engine code-refs flag-check alert recover

help: ## Show this help
	@grep -E '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

up: ## Start self-hosted Flagsmith 2.295.2 on http://localhost:8000 (waits until healthy)
	$(COMPOSE) up -d --wait

seed: ## Create admin, "Demo Shop" project, 3 environments, 7 flags; write .env
	node devkit/seed.mjs

down: ## Stop Flagsmith (keeps data)
	$(COMPOSE) down

reset: ## Stop Flagsmith and DELETE all its data
	$(COMPOSE) down -v

logs: ## Follow the Flagsmith API logs
	$(COMPOSE) logs -f flagsmith

mcp: ## Also start Flagsmith's MCP server on http://localhost:8002/mcp
	$(COMPOSE) --profile mcp up -d --wait

node_modules: package.json extension/package.json examples/demo-shop/package.json
	npm install
	@touch node_modules

install: node_modules ## Install npm dependencies

demo: node_modules ## Run the demo shop on http://localhost:3030
	node examples/demo-shop/server.mjs

ext: node_modules ## Build the extension
	npm run build

package: node_modules ## Build extension/flaglens.vsix
	npm run package

install-ext: package ## Build the .vsix and install it into VS Code
	code --install-extension $(VSIX) --force

test: node_modules ## Run unit tests
	npm test

lint: node_modules
	npm run lint

typecheck: node_modules
	npm run typecheck

check: lint typecheck test ## Lint, type-check and test

verify-engine: node_modules ## Compare FlagLens's local evaluation with the running Flagsmith (after make seed)
	npm run verify:engine -w extension

code-refs: node_modules ## Publish this repository's flag references to Flagsmith (Code References)
	npm run code-refs -w extension

flag-check: node_modules ## Check the demo shop's flag references and the project's targeting rules (as CI does)
	node extension/scripts/check.mjs --path examples/demo-shop

alert: ## Simulate a monitoring alert: new_checkout UNHEALTHY in Production (Feature Health)
	node devkit/health.mjs alert

recover: ## Mark new_checkout healthy again
	node devkit/health.mjs recover
