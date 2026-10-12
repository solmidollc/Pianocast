import { createPortal } from 'react-dom';
import { allAttributions } from '../audio/pianoEngine';

/**
 * About / Credits modal.
 *
 * The Salamander Grand Piano samples are CC BY 3.0 — attribution is
 * mandatory and this dialog is where it lives. VCSL (Versilian Community
 * Sample Library) and FreePats are CC0 and don't strictly need crediting,
 * but it's good practice and helps people find the same sample sets for
 * their own projects, so they're listed here too.
 *
 * The instrument catalogue is the source of truth for the attribution text
 * (`allAttributions()`). Adding a new instrument with a non-null
 * `attribution` automatically inserts its credit line here.
 */
export function AboutModal({ onClose }: { onClose: () => void }) {
  const credits = allAttributions();
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(7,7,9,0.74)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className="bg-ink-900 rounded-lg shadow-2xl p-6 max-w-md w-[92vw] space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-ink-500">
            About
          </div>
          <div className="text-base text-ink-50 font-medium mt-0.5">Piano Canva</div>
          <div className="text-[11px] text-ink-300 mt-1">
            Live MIDI piano performance visualiser for streaming, recording, and
            video calls.
          </div>
        </div>

        <div className="border-t border-white/8 pt-4">
          <div className="text-[10px] uppercase tracking-[0.18em] text-ink-500 mb-2">
            Sample credits
          </div>
          <ul className="space-y-2">
            {credits.map((c) => (
              <li key={c} className="text-[12px] text-ink-200 leading-relaxed">
                {c}
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-ink-400 leading-relaxed mt-3">
            Salamander Grand Piano source:{' '}
            <a
              href="https://archive.org/details/SalamanderGrandPianoV3"
              target="_blank"
              rel="noreferrer"
              className="text-accent-soft hover:text-ink-50 underline"
            >
              archive.org / SalamanderGrandPianoV3
            </a>{' '}
            (
            <a
              href="https://creativecommons.org/licenses/by/3.0/"
              target="_blank"
              rel="noreferrer"
              className="text-accent-soft hover:text-ink-50 underline"
            >
              CC BY 3.0
            </a>
            ).
            <br />
            Versilian Community Sample Library:{' '}
            <a
              href="https://github.com/sgossner/VCSL"
              target="_blank"
              rel="noreferrer"
              className="text-accent-soft hover:text-ink-50 underline"
            >
              github.com/sgossner/VCSL
            </a>{' '}
            (CC0).
            <br />
            FreePats organs (planned upgrade for the Hammond drawbar):{' '}
            <a
              href="https://freepats.zenvoid.org/Organ/"
              target="_blank"
              rel="noreferrer"
              className="text-accent-soft hover:text-ink-50 underline"
            >
              freepats.zenvoid.org/Organ
            </a>{' '}
            (CC0).
            <br />
            Web Audio sampler runtime:{' '}
            <a
              href="https://github.com/danigb/smplr"
              target="_blank"
              rel="noreferrer"
              className="text-accent-soft hover:text-ink-50 underline"
            >
              smplr
            </a>
            .
          </p>
        </div>

        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded border border-white/10 text-ink-300 hover:border-white/20"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
