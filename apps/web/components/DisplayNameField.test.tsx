// What: Behavior tests for DisplayNameField — debounced save + optimistic UI + rollback
// Why: Debounce regressions produce a keystroke-per-second write storm; optimistic
//      rollback regression silently corrupts local state against the server row
// Does NOT: Hit Supabase — all saves route through the `onSave` prop
//
// Testing note: fake timers + userEvent compose poorly (both drive the event
// loop). We pin `debounceMs` to a small real value per test and use
// `fireEvent.change` for deterministic text-synth.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DisplayNameField } from './DisplayNameField';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('<DisplayNameField>', () => {
  it('renders the initial value + "Your name" label', () => {
    render(<DisplayNameField initialValue="Meir" onSave={vi.fn()} />);
    expect(screen.getByLabelText(/your name/i)).toHaveValue('Meir');
  });

  it('debounces saves: rapid keystrokes only fire one save', async () => {
    const onSave = vi.fn().mockResolvedValue('Dad');
    render(
      <DisplayNameField initialValue="Meir" onSave={onSave} debounceMs={30} />
    );
    const input = screen.getByLabelText(/your name/i);

    // Two rapid changes inside the debounce window.
    fireEvent.change(input, { target: { value: 'D' } });
    fireEvent.change(input, { target: { value: 'Da' } });
    fireEvent.change(input, { target: { value: 'Dad' } });

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1), {
      timeout: 1000,
    });
    expect(onSave).toHaveBeenCalledWith('Dad');
  });

  it('flushes the pending debounce on blur (immediate save)', async () => {
    const onSave = vi.fn().mockResolvedValue('Dad');
    render(
      <DisplayNameField initialValue="Meir" onSave={onSave} debounceMs={5000} />
    );
    const input = screen.getByLabelText(/your name/i);

    fireEvent.change(input, { target: { value: 'Dad' } });
    // Blur long before the debounce fires.
    fireEvent.blur(input);

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1), {
      timeout: 500,
    });
    expect(onSave).toHaveBeenCalledWith('Dad');
  });

  it('trims whitespace before saving', async () => {
    const onSave = vi.fn().mockResolvedValue('Dad');
    render(
      <DisplayNameField initialValue="Meir" onSave={onSave} debounceMs={5000} />
    );
    const input = screen.getByLabelText(/your name/i);

    fireEvent.change(input, { target: { value: '  Dad  ' } });
    fireEvent.blur(input);

    await waitFor(() => expect(onSave).toHaveBeenCalledWith('Dad'), {
      timeout: 500,
    });
  });

  it('no-ops the save when the trimmed value equals the last-saved one', async () => {
    // Positive-equivalent assertion: rather than sleep 80ms and assert
    // "still no call" (false-green if debounce regresses to >80ms), we
    // prove the no-op by sandwiching it between a change that SHOULD
    // save ("Dad"). If the no-op path were broken and "Meir  " scheduled
    // a save, `onSave` would fire with "Meir" before the "Dad" change;
    // instead it fires exactly once, with "Dad".
    const onSave = vi.fn().mockResolvedValue('Meir');
    render(
      <DisplayNameField initialValue="Meir" onSave={onSave} debounceMs={20} />
    );
    const input = screen.getByLabelText(/your name/i);

    fireEvent.change(input, { target: { value: 'Meir  ' } });
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: 'Dad' } });
    fireEvent.blur(input);

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1), {
      timeout: 500,
    });
    expect(onSave).toHaveBeenCalledWith('Dad');
  });

  it('rolls back + calls onError when the save rejects', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('RLS denied'));
    const onError = vi.fn();
    render(
      <DisplayNameField
        initialValue="Meir"
        onSave={onSave}
        onError={onError}
        debounceMs={20}
      />
    );
    const input = screen.getByLabelText(/your name/i) as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'Dad' } });

    await waitFor(() => expect(onSave).toHaveBeenCalledWith('Dad'), {
      timeout: 500,
    });
    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith(expect.any(Error))
    );
    await waitFor(() => expect(input).toHaveValue('Meir'));
  });

  it('does not save an empty trimmed value (DB is NOT NULL)', async () => {
    // Positive-equivalent: sandwich the empty-trim event between a real
    // save so we can assert exactly one save call, with the right value.
    // This avoids the flaky "sleep and assert no-call" pattern that a
    // debounce-constant regression would silently pass.
    const onSave = vi.fn().mockResolvedValue('Dad');
    render(
      <DisplayNameField initialValue="Meir" onSave={onSave} debounceMs={20} />
    );
    const input = screen.getByLabelText(/your name/i);

    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: 'Dad' } });
    fireEvent.blur(input);

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1), {
      timeout: 500,
    });
    expect(onSave).toHaveBeenCalledWith('Dad');
  });
});
