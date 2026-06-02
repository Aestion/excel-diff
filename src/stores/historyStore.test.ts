import { describe, it, expect, beforeEach } from 'vitest';
import { useHistoryStore } from './historyStore';

describe('historyStore', () => {
  beforeEach(() => {
    useHistoryStore.getState().clear();
  });

  it('adds a new record', () => {
    useHistoryStore.getState().add('/old', '/new');
    const state = useHistoryStore.getState();
    expect(state.records).toHaveLength(1);
    expect(state.records[0].oldDir).toBe('/old');
    expect(state.records[0].newDir).toBe('/new');
  });

  it('moves existing record to front on duplicate add', () => {
    useHistoryStore.getState().add('/old1', '/new1');
    useHistoryStore.getState().add('/old2', '/new2');
    useHistoryStore.getState().add('/old1', '/new1'); // duplicate
    const state = useHistoryStore.getState();
    expect(state.records).toHaveLength(2);
    expect(state.records[0].oldDir).toBe('/old1');
  });

  it('trims records to max limit', () => {
    for (let i = 0; i < 10; i++) {
      useHistoryStore.getState().add(`/old${i}`, `/new${i}`);
    }
    expect(useHistoryStore.getState().records.length).toBeLessThanOrEqual(5);
  });

  it('removes a record by id', () => {
    useHistoryStore.getState().add('/old', '/new');
    const id = useHistoryStore.getState().records[0].id;
    useHistoryStore.getState().remove(id);
    expect(useHistoryStore.getState().records).toHaveLength(0);
  });

  it('renames a record', () => {
    useHistoryStore.getState().add('/old', '/new');
    const id = useHistoryStore.getState().records[0].id;
    useHistoryStore.getState().rename(id, 'My Project');
    expect(useHistoryStore.getState().records[0].name).toBe('My Project');
  });

  it('clears all records', () => {
    useHistoryStore.getState().add('/old1', '/new1');
    useHistoryStore.getState().add('/old2', '/new2');
    useHistoryStore.getState().clear();
    expect(useHistoryStore.getState().records).toHaveLength(0);
  });

  it('toggles collapsed state', () => {
    expect(useHistoryStore.getState().isCollapsed).toBe(false);
    useHistoryStore.getState().toggleCollapsed();
    expect(useHistoryStore.getState().isCollapsed).toBe(true);
    useHistoryStore.getState().toggleCollapsed();
    expect(useHistoryStore.getState().isCollapsed).toBe(false);
  });

  it('generates unique ids', () => {
    useHistoryStore.getState().add('/old', '/new');
    useHistoryStore.getState().add('/old2', '/new2');
    const state = useHistoryStore.getState();
    expect(state.records[0].id).not.toBe(state.records[1].id);
  });
});
