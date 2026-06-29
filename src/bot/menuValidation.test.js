import { describe, expect, test } from '@jest/globals';
import { validateBotMenuChains, MAX_MENU_CHAIN_DEPTH } from './menuValidation.js';

describe('validateBotMenuChains', () => {
  test('accepts a chain with only built-in actionIds', () => {
    const menus = [
      { actionId: 'promo', type: 'custom', followUpButtons: [{ text: 'Buy', actionId: 'buy_renew' }] },
    ];
    expect(() => validateBotMenuChains(menus)).not.toThrow();
  });

  test('accepts an empty menu list', () => {
    expect(() => validateBotMenuChains([])).not.toThrow();
    expect(() => validateBotMenuChains(undefined)).not.toThrow();
  });

  test('accepts a linear chain of custom items', () => {
    const menus = [
      { actionId: 'a', type: 'custom', followUpButtons: [{ text: 'next', actionId: 'b' }] },
      { actionId: 'b', type: 'custom', followUpButtons: [{ text: 'next', actionId: 'c' }] },
      { actionId: 'c', type: 'custom', followUpButtons: [] },
    ];
    expect(() => validateBotMenuChains(menus)).not.toThrow();
  });

  test('rejects a direct cycle (a -> b -> a)', () => {
    const menus = [
      { actionId: 'a', type: 'custom', followUpButtons: [{ text: 'next', actionId: 'b' }] },
      { actionId: 'b', type: 'custom', followUpButtons: [{ text: 'back', actionId: 'a' }] },
    ];
    expect(() => validateBotMenuChains(menus)).toThrow(/Cycle detected/);
  });

  test('rejects a self-referencing item', () => {
    const menus = [
      { actionId: 'a', type: 'custom', followUpButtons: [{ text: 'loop', actionId: 'a' }] },
    ];
    expect(() => validateBotMenuChains(menus)).toThrow(/Cycle detected/);
  });

  test('rejects a chain deeper than the max depth', () => {
    const menus = [];
    for (let i = 0; i <= MAX_MENU_CHAIN_DEPTH + 1; i += 1) {
      menus.push({
        actionId: `item_${i}`,
        type: 'custom',
        followUpButtons: [{ text: 'next', actionId: `item_${i + 1}` }],
      });
    }
    expect(() => validateBotMenuChains(menus)).toThrow(/exceeds maximum depth/);
  });
});
