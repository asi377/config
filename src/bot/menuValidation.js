export const MAX_MENU_CHAIN_DEPTH = 10;

/**
 * Walks every 'custom' BotMenuItem's followUpButtons chain to catch admin
 * mistakes that would otherwise only surface as an infinite/runaway chain
 * inside the live Telegram bot. Built-in actionIds terminate a chain.
 */
export function validateBotMenuChains(botMenus) {
  const customItems = new Map();
  for (const item of botMenus || []) {
    if (item.type === 'custom') customItems.set(item.actionId, item);
  }

  const visiting = new Set();
  const visited = new Set();

  function walk(actionId, depth) {
    if (depth > MAX_MENU_CHAIN_DEPTH) {
      throw new Error(`Menu chain exceeds maximum depth of ${MAX_MENU_CHAIN_DEPTH} starting at "${actionId}"`);
    }
    const item = customItems.get(actionId);
    if (!item) return;
    if (visiting.has(actionId)) {
      throw new Error(`Cycle detected in menu chain at "${actionId}"`);
    }
    if (visited.has(actionId)) return;

    visiting.add(actionId);
    for (const button of item.followUpButtons || []) {
      walk(button.actionId, depth + 1);
    }
    visiting.delete(actionId);
    visited.add(actionId);
  }

  for (const actionId of customItems.keys()) {
    walk(actionId, 0);
  }
}
