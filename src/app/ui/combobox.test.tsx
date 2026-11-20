// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { classSuggestions, rankClasses, suggestionKey } from '@/domain/work/suggestions';
import type { WorkDay } from '@/domain/work/types';
import { Combobox, Field } from './forms';

afterEach(cleanup);

const saved = [
  { className: 'Mathematics', teacherName: 'Mr. Alpha' },
  { className: 'mathematics ', teacherName: 'Mr. Alpha' },
  { className: 'Business', teacherName: 'Ms. Beta' },
  { className: 'English' },
  { className: 'History' },
].map((p, i) => ({ id: `d${i}`, date: `2026-10-0${i + 1}`, coverage: [], ...p }) as unknown as WorkDay);

/** The editor's wiring, minus the dialog: suggestions from saved days, ranked by teacher. */
function ClassField({ teacher = '', onSubmit }: { teacher?: string; onSubmit?: (v: string) => void }) {
  const [v, setV] = useState('');
  const all = classSuggestions(saved);
  const options = rankClasses(all, teacher, v)
    .filter((c) => suggestionKey(c.value) !== suggestionKey(v))
    .map((c) => ({ value: c.value, ...(c.withTeacher ? { hint: `with ${teacher}` } : {}) }));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit?.(v);
      }}
    >
      <Field label="Class or subject">
        <Combobox value={v} onChange={setV} options={options} />
      </Field>
    </form>
  );
}

const input = () => screen.getByRole('combobox', { name: 'Class or subject' });
const optionNames = () => screen.queryAllByRole('option').map((o) => o.firstChild?.textContent);

describe('class autocomplete', () => {
  it('opens a de-duplicated list of earlier classes on focus', () => {
    render(<ClassField />);
    fireEvent.focus(input());
    expect(input().getAttribute('aria-expanded')).toBe('true');
    // One entry for both spellings (the more recent one is shown); then by recency.
    expect(optionNames()).toEqual(['mathematics', 'History', 'English', 'Business']);
  });

  it('filters as the user types (case-insensitive)', () => {
    render(<ClassField />);
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: 'eNG' } });
    expect(optionNames()).toEqual(['English']);
  });

  it('keyboard: ArrowDown highlights, Enter picks without submitting, Escape closes', () => {
    let submitted: string | null = null;
    render(<ClassField onSubmit={(v) => (submitted = v)} />);
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: 'is' } }); // History, English? -> contains "is": English, History
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    const first = screen.getAllByRole('option')[0]!;
    expect(input().getAttribute('aria-activedescendant')).toBe(first.id);
    expect(first.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect((input() as HTMLInputElement).value).toBe(first.firstChild!.textContent);
    expect(submitted).toBeNull();
    fireEvent.change(input(), { target: { value: 'h' } });
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(input().getAttribute('aria-expanded')).toBe('false');
  });

  it('ArrowUp wraps to the last suggestion', () => {
    render(<ClassField />);
    fireEvent.focus(input());
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(screen.getAllByRole('option').at(-1)!.getAttribute('aria-selected')).toBe('true');
  });

  it('mouse: clicking a suggestion fills the field', () => {
    render(<ClassField />);
    fireEvent.focus(input());
    fireEvent.mouseDown(screen.getByRole('option', { name: /Business/ }));
    expect((input() as HTMLInputElement).value).toBe('Business');
  });

  it('free text: a brand-new class is kept as typed and submits normally', () => {
    let submitted = '';
    render(<ClassField onSubmit={(v) => (submitted = v)} />);
    fireEvent.change(input(), { target: { value: 'Robotics Club' } });
    expect(optionNames()).toEqual([]);
    expect(input().getAttribute('aria-expanded')).toBe('false');
    fireEvent.submit(input().closest('form')!);
    expect(submitted).toBe('Robotics Club');
  });

  it('a selected teacher’s earlier classes come first, labelled', () => {
    render(<ClassField teacher="Ms. Beta" />);
    fireEvent.focus(input());
    expect(optionNames()[0]).toBe('Business');
    expect(screen.getByRole('option', { name: /Business/ }).textContent).toContain('with Ms. Beta');
  });

  it('is optional: an empty field is valid and nothing is pre-selected', () => {
    render(<ClassField />);
    expect((input() as HTMLInputElement).value).toBe('');
    expect(input().getAttribute('aria-required')).toBeNull();
  });
});
