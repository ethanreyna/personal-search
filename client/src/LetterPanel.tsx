import { useState } from 'react';
import { downloadLetter, type LetterContent } from './pdf';

interface Props {
  letter: LetterContent;
  organization: string | null;
  onChange: (letter: LetterContent) => void;
  /** Persists the current body. */
  onSave: () => Promise<unknown>;
  onRedo: () => void;
  onHide?: () => void;
  redoing: boolean;
}

/** Editable letter with PDF download, copy and redo. */
export default function LetterPanel({ letter, organization, onChange, onSave, onRedo, onHide, redoing }: Props) {
  const [building, setBuilding] = useState(false);
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const pdf = async () => {
    setBuilding(true);
    setNote(null);
    try {
      await onSave();
      await downloadLetter(letter, organization);
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'PDF failed');
    } finally {
      setBuilding(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(letter.body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setNote('Clipboard not available');
    }
  };

  return (
    <div className="draft">
      <textarea rows={16} value={letter.body} onChange={(e) => onChange({ ...letter, body: e.target.value })} onBlur={onSave} />
      <div className="actions">
        <button onClick={pdf} disabled={building || redoing}>
          {building ? 'Building…' : 'Download letter PDF'}
        </button>
        <button onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
        <button onClick={onRedo} disabled={building || redoing}>
          {redoing ? 'Writing…' : 'Redo letter'}
        </button>
        {onHide && <button onClick={onHide}>Hide</button>}
      </div>
      {note && <p className="note">{note}</p>}
    </div>
  );
}
