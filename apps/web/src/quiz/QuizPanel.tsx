import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GAME_CONFIG } from "@stock-arena/game-core";
import type { QuizView } from "@stock-arena/game-core";
import type { PlatformAdapter } from "../platform/types.js";
import { en } from "../copy/en.js";
import { createQuizClient, QuizClientError } from "./client.js";
import type { QuizAction } from "./client.js";

export function QuizPanel({
  platform,
  enabled,
  onCompleted,
}: {
  platform: PlatformAdapter;
  enabled: boolean;
  onCompleted: () => void;
}) {
  const allowed = enabled && platform.host !== "browser";
  const client = useMemo(() => createQuizClient(() => platform.session), [platform]);
  const [view, setView] = useState<QuizView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"unavailable" | "session" | "network" | null>(null);
  const [clock, setClock] = useState(Date.now());
  const pending = useRef(false);
  const generation = useRef(0);
  const received = useRef({ local: Date.now(), server: Date.now() });
  const completed = useRef<string | null>(null);
  const notify = useRef(onCompleted);
  notify.current = onCompleted;
  const run = useCallback(
    async (action: QuizAction, current?: QuizView, choice?: number | null) => {
      if (!allowed || pending.current) return;
      pending.current = true;
      setBusy(true);
      setError(null);
      const id = generation.current;
      try {
        const question = current?.question;
        const result = await client.call(
          action,
          action === "answer" && question && current
            ? {
                day: current.day,
                questionId: question.id,
                position: question.position,
                choice: choice ?? null,
              }
            : undefined,
        );
        if (generation.current !== id) return;
        received.current = { local: Date.now(), server: Date.parse(result.serverTime) };
        setClock(Date.now());
        setView(result);
        if (result.status === "completed" && completed.current !== result.day) {
          completed.current = result.day;
          notify.current();
        }
      } catch (cause) {
        if (generation.current === id)
          setError(cause instanceof QuizClientError ? cause.code : "network");
      } finally {
        if (generation.current === id) {
          pending.current = false;
          setBusy(false);
        }
      }
    },
    [allowed, client],
  );
  useEffect(() => {
    const id = ++generation.current;
    pending.current = false;
    setView(null);
    setError(null);
    setBusy(false);
    void run("read");
    return () => {
      generation.current = id + 1;
    };
  }, [run]);
  useEffect(() => {
    if (!view?.question) return;
    const interval = setInterval(() => setClock(Date.now()), 250);
    const serverNow = received.current.server + Date.now() - received.current.local;
    const expiry = Date.parse(view.question.deadline) + GAME_CONFIG.quiz.graceSeconds * 1000 + 100;
    const timer = setTimeout(
      () => {
        void run("answer", view, null);
      },
      Math.max(0, expiry - serverNow),
    );
    return () => {
      clearInterval(interval);
      clearTimeout(timer);
    };
  }, [view, run]);
  useEffect(() => {
    if (!allowed) return;
    const refresh = () => {
      if (document.visibilityState === "visible") void run("read");
    };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [allowed, run]);
  useEffect(() => {
    if (!view) return;
    const serverTime = new Date(view.serverTime);
    const midnight = Date.UTC(
      serverTime.getUTCFullYear(),
      serverTime.getUTCMonth(),
      serverTime.getUTCDate() + 1,
    );
    const serverNow = received.current.server + Date.now() - received.current.local;
    const timer = setTimeout(
      () => {
        void run("read");
      },
      Math.max(1000, midnight - serverNow + 100),
    );
    return () => clearTimeout(timer);
  }, [view, run]);
  if (!allowed) return <p className="muted">{en.quiz.preview}</p>;
  const serverNow = received.current.server + clock - received.current.local;
  const seconds = view?.question
    ? Math.max(0, Math.ceil((Date.parse(view.question.deadline) - serverNow) / 1000))
    : 0;
  const question = view?.question;
  const feedback = view?.feedback;
  return (
    <div className="quiz-panel" aria-busy={busy}>
      {error && (
        <div role="alert">
          <p>
            {error === "session"
              ? en.quiz.sessionError
              : error === "unavailable"
                ? en.quiz.unavailable
                : en.quiz.error}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void run("read");
            }}
          >
            {en.quiz.retry}
          </button>
        </div>
      )}
      {!view && !error && <p className="muted">{en.quiz.loading}</p>}
      {view?.status === "ready" && (
        <button
          className="primary-button"
          type="button"
          disabled={busy}
          onClick={() => {
            void run("start");
          }}
        >
          {en.quiz.start}
        </button>
      )}
      {question && (
        <>
          <div className="section-heading">
            <span>
              {en.quiz.progress} {question.position + 1} {en.quiz.of} {view.total}
            </span>
            <span
              className={`pill number ${seconds === 0 ? "down" : ""}`}
              aria-label={`${seconds} ${en.quiz.seconds}`}
            >
              {seconds} {en.quiz.seconds}
            </span>
          </div>
          <div className="quiz-progress" aria-hidden="true">
            <span style={{ width: `${(view.answered / view.total) * 100}%` }} />
          </div>
          <p className="eyebrow">{question.topic}</p>
          <h3 className="quiz-prompt">{question.prompt}</h3>
          <div className="quiz-options">
            {question.options.map((option, index) => (
              <button
                className="quiz-option"
                type="button"
                key={index}
                disabled={busy || seconds === 0}
                onClick={() => {
                  void run("answer", view, index);
                }}
              >
                <span className="number">{String.fromCharCode(65 + index)}</span>
                {option}
              </button>
            ))}
          </div>
          {seconds === 0 && <p className="muted">{en.quiz.expired}</p>}
        </>
      )}
      {(view?.status === "feedback" || view?.status === "completed") && feedback && (
        <div className="quiz-verdict" role="status">
          <h3 className={feedback.correct ? "accent" : "down"}>
            {feedback.timedOut
              ? en.quiz.expired
              : feedback.correct
                ? en.quiz.correct
                : en.quiz.wrong}
          </h3>
          <p className="quiz-prompt">{feedback.prompt}</p>
          <div className="quiz-options">
            {feedback.options.map((option, index) => (
              <div
                key={index}
                className={`quiz-option ${index === feedback.correctOption ? "quiz-correct" : index === feedback.choice ? "quiz-wrong" : ""}`}
              >
                <span className="number">{String.fromCharCode(65 + index)}</span>
                {option}
                {index === feedback.correctOption ? (
                  <span aria-label={en.quiz.correctOption}>✓</span>
                ) : index === feedback.choice ? (
                  <span aria-hidden="true">×</span>
                ) : null}
              </div>
            ))}
          </div>
          <p>{feedback.explanation}</p>
        </div>
      )}
      {view?.status === "feedback" && (
        <button
          className="primary-button"
          type="button"
          disabled={busy}
          onClick={() => {
            void run("next");
          }}
        >
          {en.quiz.next}
        </button>
      )}
      {view?.status === "completed" && (
        <div className="quiz-result">
          <h3>{en.quiz.completed}</h3>
          <p className="number">
            {en.quiz.score}: {view.score} {en.labels.points}
          </p>
          <p className="muted">{en.quiz.tomorrow}</p>
        </div>
      )}
      {busy && <p className="caption muted">{question ? en.quiz.saving : en.quiz.loading}</p>}
    </div>
  );
}
