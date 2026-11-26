import { expect, it } from 'vitest';
import { itemColor, itemLineWidth } from '../apps/web/src/schematicColors';

const items = ['iron-ore', 'iron-ingot', 'iron-plate', 'iron-rod', 'screw', 'reinforced-iron-plate', 'copper-ore', 'copper-ingot', 'wire', 'cable'];

it('даёт предмету один и тот же цвет между вызовами', () => {
  for (const id of items) expect(itemColor(id, false)).toBe(itemColor(id, false));
  expect(itemColor('water', true)).toBe(itemColor('water', true));
});

it('различает не меньше 8 цветов у 10 разных предметов', () => {
  expect(new Set(items.map(id => itemColor(id, false))).size).toBeGreaterThanOrEqual(8);
  expect(new Set(items.map(id => itemColor(id, true))).size).toBeGreaterThanOrEqual(8);
});

it('красит жидкость иначе, чем твёрдый предмет с тем же id, и рисует её толще', () => {
  for (const id of items) expect(itemColor(id, true)).not.toBe(itemColor(id, false));
  expect(itemLineWidth(true)).toBe(3);
  expect(itemLineWidth(false)).toBe(2);
});
