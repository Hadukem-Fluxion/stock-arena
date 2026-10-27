import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { en } from "../copy/en.js";
export function FlightDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="flight-dialog"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button autoFocus onClick={onClose} aria-label={en.flyer.close}>
          ×
        </button>
      </header>
      {children}
    </dialog>
  );
}
