import { useEffect, useRef, useState } from 'react';
import {
  startExamSession,
  fetchQuestions,
  submitAnswer,
  submitExam,
} from './api';
import './App.css';

function App() {
  // Screen views: 'SETUP' | 'EXAM' | 'RESULTS'
  const [screen, setScreen] = useState('SETUP');

  // Candidate Setup State
  const [candidateName, setCandidateName] = useState('Alex Johnson');
  const [userId, setUserId] = useState(
    () => 'STU-' + Math.floor(1000 + Math.random() * 9000)
  );

  // Permission & Hardware State
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const videoRef = useRef(null);

  // Exam State
  const [sessionId, setSessionId] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [userAnswers, setUserAnswers] = useState({}); // { questionId: selectedIndex }
  const [savedAnswers, setSavedAnswers] = useState({}); // { questionId: { selectedAnswer, isCorrect } }
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState('');
  const [feedbackMessage, setFeedbackMessage] = useState('');

  // Timer & Proctoring State
  const [secondsElapsed, setSecondsElapsed] = useState(0);
  const [isRulesOpen, setIsRulesOpen] = useState(false);
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);

  // Final Results State
  const [examResult, setExamResult] = useState(null);

  // -------------------------------------------------------------
  // Electron Listeners & Timer Ticks
  // -------------------------------------------------------------
  useEffect(() => {
    let removeTimerListener;
    let removeCameraListener;

    if (window.athena) {
      if (window.athena.registerListenerForTimerTickFromMain) {
        removeTimerListener = window.athena.registerListenerForTimerTickFromMain(
          (sec) => {
            setSecondsElapsed(Math.floor(sec));
          }
        );
      }

      if (window.athena.registerListenerForCameraSnapFromMain) {
        removeCameraListener = window.athena.registerListenerForCameraSnapFromMain(
          saveVideoScreenshots
        );
      }
    }

    return () => {
      if (removeTimerListener) removeTimerListener();
      if (removeCameraListener) removeCameraListener();
    };
  }, []);

  // Web Fallback Timer if not driven by Electron or during active exam
  useEffect(() => {
    let interval;
    if (screen === 'EXAM') {
      interval = setInterval(() => {
        setSecondsElapsed((prev) => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [screen]);

  // Camera Shot Capture logic for Heimdall Proctoring
  async function saveVideoScreenshots() {
    if (!videoRef.current || !videoRef.current.srcObject) return;
    try {
      const track = videoRef.current.srcObject.getVideoTracks()[0];
      if (!track) return;

      if (typeof ImageCapture !== 'undefined') {
        const imageCapture = new ImageCapture(track);
        const blob = await imageCapture.takePhoto();
        const arrayBuffer = await blob.arrayBuffer();
        window.athena?.storeCameraSnapImageOnDisk(arrayBuffer);
      }
    } catch (err) {
      console.error('Camera snap capture error:', err);
    }
  }

  // -------------------------------------------------------------
  // Setup Actions
  // -------------------------------------------------------------
  async function getCameraAccess() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCameraEnabled(true);
    } catch (err) {
      alert('Camera access denied or device unavailable. Please allow camera access.');
    }
  }

  async function enableFullScreen() {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }
      setFullScreen(true);
    } catch (err) {
      alert('Full screen request denied or unavailable.');
    }
  }

  async function handleStartExam() {
    if (!candidateName.trim() || !userId.trim()) {
      setApiError('Please fill in both Candidate Name and User ID.');
      return;
    }

    setLoading(true);
    setApiError('');

    try {
      // 1. Start Session on Backend
      const startRes = await startExamSession(userId, candidateName);
      setSessionId(startRes.sessionId);

      // 2. Fetch Questions from Backend
      const qList = await fetchQuestions();
      setQuestions(qList);
      setCurrentIndex(0);
      setUserAnswers({});
      setSavedAnswers({});
      setSecondsElapsed(0);

      // 3. Trigger Main Process Timer if available
      try {
        await window.athena?.startTimerOnMain();
      } catch (e) {
        console.log('Main process timer not available or already running.');
      }

      setScreen('EXAM');
    } catch (err) {
      setApiError(err.message || 'Error initializing exam session. Make sure backend is running.');
    } finally {
      setLoading(false);
    }
  }

  // -------------------------------------------------------------
  // Exam Actions
  // -------------------------------------------------------------
  function handleSelectOption(optionIndex) {
    const currentQ = questions[currentIndex];
    if (!currentQ) return;
    setUserAnswers((prev) => ({
      ...prev,
      [currentQ.id]: optionIndex,
    }));
  }

  function handleClearSelection() {
    const currentQ = questions[currentIndex];
    if (!currentQ) return;
    setUserAnswers((prev) => {
      const copy = { ...prev };
      delete copy[currentQ.id];
      return copy;
    });
  }

  async function handleSaveAndNext() {
    const currentQ = questions[currentIndex];
    if (!currentQ) return;

    const selectedOpt = userAnswers[currentQ.id];
    setFeedbackMessage('');
    setApiError('');

    if (selectedOpt !== undefined && sessionId) {
      // Submit answer to backend API if not already submitted
      if (!savedAnswers[currentQ.id]) {
        try {
          const res = await submitAnswer(sessionId, currentQ.id, selectedOpt);
          setSavedAnswers((prev) => ({
            ...prev,
            [currentQ.id]: {
              selectedAnswer: selectedOpt,
              isCorrect: res.isCorrect,
            },
          }));
          setFeedbackMessage('Answer saved successfully!');
        } catch (err) {
          // If already answered on backend, record locally
          setSavedAnswers((prev) => ({
            ...prev,
            [currentQ.id]: { selectedAnswer: selectedOpt },
          }));
        }
      }
    }

    if (currentIndex < questions.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    }
  }

  async function handleFinalSubmit() {
    if (!sessionId) return;
    setLoading(true);
    setApiError('');

    try {
      const res = await submitExam(sessionId);
      setExamResult({
        ...res.result,
        total: questions.length,
        scorePercentage: Math.round(
          (res.result.correct / (questions.length || 1)) * 100
        ),
      });
      setIsSubmitModalOpen(false);
      setScreen('RESULTS');
    } catch (err) {
      setApiError(err.message || 'Failed to submit exam');
    } finally {
      setLoading(false);
    }
  }

  function formatTimer(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  function handleShowRules() {
    if (window.athena?.showRules) {
      window.athena.showRules();
    } else {
      setIsRulesOpen(true);
    }
  }

  // -------------------------------------------------------------
  // Render Views
  // -------------------------------------------------------------

  return (
    <div className="app-shell">
      {/* Dynamic Header */}
      <header className="brand-header">
        <div className="header-left">
          <div className="logo-icon">A</div>
          <div>
            <h1 className="brand-title">ATHENA</h1>
            <span className="brand-tagline">Proctored Assessment Environment</span>
          </div>
        </div>

        {screen === 'EXAM' && (
          <div className="header-center">
            <div className="timer-badge">
              <span className="pulse-dot"></span>
              <span className="timer-text">{formatTimer(secondsElapsed)}</span>
            </div>
          </div>
        )}

        <div className="header-right">
          {screen === 'EXAM' && (
            <button className="rules-btn" onClick={handleShowRules}>
              📋 Exam Rules
            </button>
          )}

          {/* Heimdall Video Preview PIP */}
          <div className={`webcam-pip ${cameraEnabled ? 'active' : ''}`}>
            <video ref={videoRef} autoPlay playsInline muted className="pip-feed" />
            <div className="pip-status">
              <span className={`status-dot ${cameraEnabled ? 'online' : 'offline'}`}></span>
              <span>{cameraEnabled ? 'Heimdall Active' : 'Camera Off'}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Body Switcher */}
      <main className="main-content">
        {/* ----------------------------------------------------
            SCREEN 1: SETUP & PERMISSIONS
           ---------------------------------------------------- */}
        {screen === 'SETUP' && (
          <div className="setup-container">
            <div className="setup-card">
              <div className="card-header">
                <h2>Welcome to Athena Online Assessment</h2>
                <p>Please complete candidate registration and system checks to begin.</p>
              </div>

              {apiError && <div className="alert alert-error">{apiError}</div>}

              {/* Candidate Info Fields */}
              <div className="input-group-row">
                <div className="input-group">
                  <label htmlFor="candidate-name">Candidate Full Name</label>
                  <input
                    id="candidate-name"
                    type="text"
                    value={candidateName}
                    onChange={(e) => setCandidateName(e.target.value)}
                    placeholder="Enter your name"
                  />
                </div>
                <div className="input-group">
                  <label htmlFor="user-id">Candidate ID / Roll No</label>
                  <input
                    id="user-id"
                    type="text"
                    value={userId}
                    onChange={(e) => setUserId(e.target.value)}
                    placeholder="Enter candidate ID"
                  />
                </div>
              </div>

              <div className="divider"></div>

              {/* Permission Check 1: Camera */}
              <div className="check-item">
                <div className="check-icon">📹</div>
                <div className="check-info">
                  <h3>Heimdall Camera Access</h3>
                  <p>Webcam video monitoring is required throughout the test.</p>
                </div>
                <button
                  className={`btn ${cameraEnabled ? 'btn-success' : 'btn-dark'}`}
                  onClick={getCameraAccess}
                  disabled={cameraEnabled}
                >
                  {cameraEnabled ? '✓ Camera Connected' : 'Enable Camera'}
                </button>
              </div>

              {/* Permission Check 2: Fullscreen */}
              <div className="check-item">
                <div className="check-icon">🖥️</div>
                <div className="check-info">
                  <h3>Fullscreen Mode</h3>
                  <p>The exam environment operates in full screen mode.</p>
                </div>
                <button
                  className={`btn ${fullScreen ? 'btn-success' : 'btn-dark'}`}
                  onClick={enableFullScreen}
                  disabled={fullScreen}
                >
                  {fullScreen ? '✓ Fullscreen Enabled' : 'Enable Fullscreen'}
                </button>
              </div>

              <div className="divider"></div>

              {/* Action Bar */}
              <div className="setup-actions">
                <button
                  className="btn btn-primary btn-large"
                  disabled={loading || !candidateName || !userId}
                  onClick={handleStartExam}
                >
                  {loading ? 'Initializing Exam...' : '🚀 Start Exam Now'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ----------------------------------------------------
            SCREEN 2: ACTIVE EXAM
           ---------------------------------------------------- */}
        {screen === 'EXAM' && questions.length > 0 && (
          <div className="exam-container">
            {/* Left Sidebar: Question Palette */}
            <aside className="exam-sidebar">
              <div className="candidate-badge">
                <div className="candidate-avatar">
                  {candidateName.charAt(0).toUpperCase()}
                </div>
                <div className="candidate-details">
                  <span className="name">{candidateName}</span>
                  <span className="id">ID: {userId}</span>
                </div>
              </div>

              <div className="palette-header">
                <h3>Question Navigator</h3>
                <span className="answered-count">
                  {Object.keys(userAnswers).length} / {questions.length} Answered
                </span>
              </div>

              <div className="question-grid">
                {questions.map((q, idx) => {
                  const isCurrent = idx === currentIndex;
                  const isAnswered = userAnswers[q.id] !== undefined;

                  let statusClass = 'unanswered';
                  if (isCurrent) statusClass = 'current';
                  else if (isAnswered) statusClass = 'answered';

                  return (
                    <button
                      key={q.id}
                      className={`palette-btn ${statusClass}`}
                      onClick={() => setCurrentIndex(idx)}
                    >
                      {idx + 1}
                    </button>
                  );
                })}
              </div>

              <div className="palette-legend">
                <div className="legend-item">
                  <span className="legend-box answered"></span> Answered
                </div>
                <div className="legend-item">
                  <span className="legend-box current"></span> Current
                </div>
                <div className="legend-item">
                  <span className="legend-box unanswered"></span> Unanswered
                </div>
              </div>

              <div className="sidebar-submit">
                <button
                  className="btn btn-accent btn-block"
                  onClick={() => setIsSubmitModalOpen(true)}
                >
                  Finish & Submit Exam
                </button>
              </div>
            </aside>

            {/* Right Workspace: Current Question display */}
            <section className="exam-workspace">
              {apiError && <div className="alert alert-error">{apiError}</div>}
              {feedbackMessage && (
                <div className="alert alert-success">{feedbackMessage}</div>
              )}

              <div className="question-card">
                <div className="question-card-header">
                  <div className="question-number">
                    Question {currentIndex + 1} of {questions.length}
                  </div>
                  <div className="question-type-tag">Multiple Choice (MCQ)</div>
                </div>

                <div className="progress-bar-container">
                  <div
                    className="progress-bar-fill"
                    style={{
                      width: `${((currentIndex + 1) / questions.length) * 100}%`,
                    }}
                  ></div>
                </div>

                <div className="question-text">
                  {questions[currentIndex]?.question}
                </div>

                <div className="options-list">
                  {questions[currentIndex]?.options.map((option, optIdx) => {
                    const currentQId = questions[currentIndex].id;
                    const isSelected = userAnswers[currentQId] === optIdx;

                    return (
                      <div
                        key={optIdx}
                        className={`option-card ${isSelected ? 'selected' : ''}`}
                        onClick={() => handleSelectOption(optIdx)}
                      >
                        <div className="option-radio">
                          <span className="radio-circle"></span>
                        </div>
                        <div className="option-label">
                          <span className="option-letter">
                            {String.fromCharCode(65 + optIdx)}.
                          </span>
                          <span className="option-content">{option}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Bottom Navigation Buttons */}
                <div className="question-footer">
                  <div className="footer-left">
                    <button
                      className="btn btn-outline"
                      onClick={handleClearSelection}
                      disabled={userAnswers[questions[currentIndex]?.id] === undefined}
                    >
                      Clear Selection
                    </button>
                  </div>

                  <div className="footer-right">
                    <button
                      className="btn btn-secondary"
                      onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
                      disabled={currentIndex === 0}
                    >
                      ← Previous
                    </button>

                    <button
                      className="btn btn-primary"
                      onClick={handleSaveAndNext}
                    >
                      {currentIndex === questions.length - 1
                        ? 'Save Answer'
                        : 'Save & Next →'}
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* ----------------------------------------------------
            SCREEN 3: RESULTS SUMMARY
           ---------------------------------------------------- */}
        {screen === 'RESULTS' && examResult && (
          <div className="results-container">
            <div className="results-card">
              <div className="results-header">
                <div className="trophy-icon">🏆</div>
                <h2>Exam Submitted Successfully!</h2>
                <p>
                  Thank you, <strong>{candidateName}</strong>. Your answers have been evaluated and recorded.
                </p>
              </div>

              {/* Score Highlight Box */}
              <div className="score-summary-box">
                <div className="score-circle">
                  <span className="score-val">{examResult.scorePercentage}%</span>
                  <span className="score-lbl">Score</span>
                </div>

                <div className="stats-grid">
                  <div className="stat-card">
                    <span className="stat-num">{examResult.total}</span>
                    <span className="stat-lbl">Total Questions</span>
                  </div>

                  <div className="stat-card">
                    <span className="stat-num attempted">{examResult.attempted}</span>
                    <span className="stat-lbl">Attempted</span>
                  </div>

                  <div className="stat-card">
                    <span className="stat-num correct">{examResult.correct}</span>
                    <span className="stat-lbl">Correct Answers</span>
                  </div>

                  <div className="stat-card">
                    <span className="stat-num wrong">{examResult.wrong}</span>
                    <span className="stat-lbl">Wrong Answers</span>
                  </div>
                </div>
              </div>

              <div className="results-actions">
                <button
                  className="btn btn-primary btn-large"
                  onClick={() => {
                    setScreen('SETUP');
                    setExamResult(null);
                  }}
                >
                  Take Another Assessment
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Rules Modal (Web Fallback) */}
      {isRulesOpen && (
        <div className="modal-backdrop" onClick={() => setIsRulesOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Athena Assessment Rules</h3>
              <button className="close-btn" onClick={() => setIsRulesOpen(false)}>
                &times;
              </button>
            </div>
            <div className="modal-body">
              <ol className="rules-list">
                <li>Stay on the exam window at all times. Switching tabs or windows is logged.</li>
                <li>Camera monitoring (Heimdall) must remain active throughout the session.</li>
                <li>Do not close or leave the exam before completing all questions.</li>
                <li>No external software, secondary screens, or assistance allowed.</li>
                <li>Click <strong>Finish & Submit Exam</strong> once you have answered all questions.</li>
              </ol>
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => setIsRulesOpen(false)}>
                I Understand
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Submit Confirmation Modal */}
      {isSubmitModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsSubmitModalOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Confirm Exam Submission</h3>
              <button
                className="close-btn"
                onClick={() => setIsSubmitModalOpen(false)}
              >
                &times;
              </button>
            </div>
            <div className="modal-body">
              <p>Are you sure you want to submit your exam now?</p>
              <div className="submit-stats-preview">
                <div>
                  <strong>Total Questions:</strong> {questions.length}
                </div>
                <div>
                  <strong>Questions Answered:</strong>{' '}
                  {Object.keys(userAnswers).length}
                </div>
                <div>
                  <strong>Unanswered:</strong>{' '}
                  {questions.length - Object.keys(userAnswers).length}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-outline"
                onClick={() => setIsSubmitModalOpen(false)}
              >
                Continue Test
              </button>
              <button
                className="btn btn-accent"
                onClick={handleFinalSubmit}
                disabled={loading}
              >
                {loading ? 'Submitting...' : 'Yes, Submit Exam'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;