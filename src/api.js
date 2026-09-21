// API service for Athena Exam Backend

const BASE_URL = "http://localhost:3000";

/**
 * Start a new exam session
 * @param {string} userId 
 * @param {string} name 
 */
export async function startExamSession(userId, name) {
  const response = await fetch(`${BASE_URL}/exam/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, name }),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || "Failed to start exam session");
  }
  return await response.json(); // { message, sessionId }
}

/**
 * Get all questions (without correct answers)
 */
export async function fetchQuestions() {
  const response = await fetch(`${BASE_URL}/exam/mcq`);
  if (!response.ok) {
    throw new Error("Failed to fetch exam questions");
  }
  return await response.json(); // Array of { id, question, options }
}

/**
 * Get single question details
 * @param {number|string} id 
 */
export async function fetchQuestionById(id) {
  const response = await fetch(`${BASE_URL}/exam/mcq/${id}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch question ${id}`);
  }
  return await response.json();
}

/**
 * Submit one answer for a question in a session
 * @param {string} sessionId 
 * @param {number} questionId 
 * @param {number} selectedAnswer 
 */
export async function submitAnswer(sessionId, questionId, selectedAnswer) {
  const response = await fetch(`${BASE_URL}/exam/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, questionId, selectedAnswer }),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || "Failed to submit answer");
  }
  return await response.json(); // { message, isCorrect, attempted, correct, wrong }
}

/**
 * Get session details and progress
 * @param {string} sessionId 
 */
export async function getSessionProgress(sessionId) {
  const response = await fetch(`${BASE_URL}/exam/session/${sessionId}`);
  if (!response.ok) {
    throw new Error("Failed to fetch session progress");
  }
  return await response.json();
}

/**
 * Submit the whole exam session
 * @param {string} sessionId 
 */
export async function submitExam(sessionId) {
  const response = await fetch(`${BASE_URL}/exam/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || "Failed to submit exam");
  }
  return await response.json(); // { message, result: { attempted, correct, wrong } }
}
