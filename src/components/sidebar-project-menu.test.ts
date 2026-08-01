import { describe, expect, it } from 'vitest';

import { catalogueFor } from '../lib/i18n';
import { projectMenuItems } from './ProjectPlusMenu';

/**
 * The Projects `+` used to open the folder picker outright. It is a menu now,
 * and these pin the two things that made that change safe to make: the old
 * behaviour is still the first thing the menu offers, and nothing in it is
 * conditional on state a new user does not have yet.
 */
describe('projectMenuItems', () => {
  it('offers exactly the three documented ways to add a project', () => {
    const items = projectMenuItems();
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.label)).toEqual([
      'Choose a local folder',
      'Clone from a URL',
      'New project',
    ]);
  });

  it('puts the existing behaviour first', () => {
    // Anyone who hits Enter without reading the menu — which is what the `+`
    // trained them to do — must land on what the button did before.
    expect(projectMenuItems()[0].label).toBe('Choose a local folder');
  });

  it('enables every entry, unlike the Session menu', () => {
    // Session's "New task" is disabled until a project is linked. All three of
    // these work from an empty app, which is precisely when they are needed.
    for (const item of projectMenuItems()) {
      expect(item.disabled, item.label).toBeFalsy();
    }
  });

  it('gives every entry a tooltip, since the labels alone are terse', () => {
    for (const item of projectMenuItems()) {
      expect(item.tooltip?.trim(), item.label).toBeTruthy();
    }
  });

  it('gives every entry an icon, so the menu is scannable without reading', () => {
    for (const item of projectMenuItems()) {
      expect(item.icon, item.label).toBeTruthy();
    }
  });

  it('translates every label and tooltip', () => {
    const zh = catalogueFor('zh-TW');
    for (const item of projectMenuItems()) {
      expect(zh[item.label], `missing translation for "${item.label}"`).toBeTruthy();
      expect(zh[item.tooltip ?? ''], `missing translation for "${item.tooltip}"`).toBeTruthy();
    }
  });
});
