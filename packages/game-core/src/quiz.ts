/** Public quiz DTOs contain no answer key for unanswered questions. */
export type QuizQuestion = {
  id: string;
  position: number;
  topic: string;
  prompt: string;
  options: [string, string, string, string];
  servedAt: string;
  deadline: string;
};
export type QuizFeedback = {
  prompt: string;
  options: [string, string, string, string];
  questionId: string;
  position: number;
  choice: number | null;
  correct: boolean;
  timedOut: boolean;
  correctOption: number;
  explanation: string;
};
export type QuizView = {
  day: string;
  serverTime: string;
  status: "ready" | "question" | "feedback" | "completed";
  total: number;
  answered: number;
  score: number;
  question: QuizQuestion | null;
  feedback: QuizFeedback | null;
};
