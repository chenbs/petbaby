"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

import { FunTestResultView, type FunTestResult } from "@/components/fun-test-result";
import { apiFetch } from "@/lib/api";

type TestSummary = { id: string; title: string; subtitle: string; category: string; cover: string; questionCount: number };
type TestDetail = TestSummary & { introduction: string; disclaimer: string; questions: Array<{ prompt: string; choices: string[] }> };
type Pet = { id: string; name: string; isDefault?: boolean };
const resultRevealMs = 2600;

export function FunTestsClient({ initialTests }: { initialTests: TestSummary[] }) {
  const [view, setView] = useState<"list" | "intro" | "question" | "thinking" | "result">("list");
  const [test, setTest] = useState<TestDetail>();
  const [petName, setPetName] = useState("");
  const [pets, setPets] = useState<Pet[]>([]);
  const [answers, setAnswers] = useState<number[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [result, setResult] = useState<FunTestResult>();
  const [history, setHistory] = useState<FunTestResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    Promise.all([
      apiFetch<Pet[]>("/api/pets").catch(() => []),
      apiFetch<FunTestResult[]>("/api/fun-test-results").catch(() => []),
    ]).then(([availablePets, saved]) => {
      if (!active) return;
      setPets(availablePets);
      setPetName((current) => current || (availablePets.find((pet) => pet.isDefault) || availablePets[0])?.name || "");
      setHistory(saved);
    });
    return () => { active = false; };
  }, []);

  async function openTest(id: string) {
    setBusy(true); setError("");
    try {
      const detail = await apiFetch<TestDetail>(`/api/fun-tests/${id}`);
      setTest(detail);
      setAnswers([]);
      setQuestionIndex(0);
      setView("intro");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "测试加载失败"); }
    finally { setBusy(false); }
  }

  async function start() {
    if (!petName.trim()) { setError("先写下宠物的名字"); return; }
    if (!test) return;
    setError("");
    setBusy(true);
    try {
      await apiFetch(`/api/fun-tests/${test.id}/start`, { method: "POST", body: "{}" });
      setAnswers([]);
      setQuestionIndex(0);
      setView("question");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "暂时无法开始测试"); }
    finally { setBusy(false); }
  }

  async function choose(choiceIndex: number) {
    if (!test || busy) return;
    const next = [...answers];
    next[questionIndex] = choiceIndex;
    setAnswers(next);
    setError("");
    if (questionIndex < test.questions.length - 1) { setQuestionIndex(questionIndex + 1); return; }
    setBusy(true);
    setView("thinking");
    const revealDelay = new Promise<void>((resolve) => setTimeout(resolve, resultRevealMs));
    try {
      const created = await apiFetch<FunTestResult>(`/api/fun-tests/${test.id}`, {
        method: "POST", body: JSON.stringify({ petName: petName.trim(), answers: next }),
      });
      await revealDelay;
      setResult(created);
      setHistory((saved) => [created, ...saved]);
      setView("result");
    } catch (failure) {
      setView("question");
      setError(failure instanceof Error ? failure.message : "结果生成失败，请重试");
    }
    finally { setBusy(false); }
  }

  async function removeResult() {
    if (!result || busy || !window.confirm("删除后，分享链接也会失效。确定删除这份结果吗？")) return;
    setBusy(true);
    try {
      await apiFetch(`/api/fun-test-results/${result.id}`, { method: "DELETE" });
      setHistory((saved) => saved.filter((item) => item.id !== result.id));
      setResult(undefined);
      setView("list");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "删除失败"); }
    finally { setBusy(false); }
  }

  return <main className="screen ft-screen">
    <header className="ft-topbar"><Link href="/" aria-label="返回首页">←</Link><span>麻麻抱我 / 趣味测试</span><span>FREE</span></header>
    {view === "list" ? <>
      <section className="ft-heading"><span className="ft-eyebrow">PET PERSONALITY CLUB</span><h1>它的小秘密，<br /><em>你最懂。</em></h1><p>从每天都看得见的小动作里，发现你们自己的答案。</p></section>
      <div className="ft-catalog">{initialTests.map((item, index) => <button className={`ft-catalog-item ft-theme-${item.cover}`} type="button" onClick={() => openTest(item.id)} disabled={busy} key={item.id}>
        <div className="ft-cover"><Image src={`/fun-tests/${item.cover}.jpg`} alt="" fill sizes="(max-width: 600px) 45vw, 220px" loading="eager" unoptimized /><span>0{index + 1}</span></div>
        <div className="ft-catalog-copy"><small>{item.category} · {item.questionCount} 题</small><strong>{item.title}</strong><p>{item.subtitle}</p><span>开始测试 →</span></div>
      </button>)}</div>
      {history.length ? <section className="ft-history"><h2>测过的它</h2><div>{history.map((item) => <button key={item.id} type="button" onClick={() => { setResult(item); setView("result"); }}><span>{item.petName} · {item.testTitle}</span><b>{item.outcome.name} →</b></button>)}</div></section> : null}
    </> : null}

    {view === "intro" && test ? <section className={`ft-intro ft-theme-${test.cover}`}>
      <button className="ft-back" type="button" onClick={() => setView("list")}>← 全部测试</button>
      <div className="ft-intro-cover"><Image src={`/fun-tests/${test.cover}.jpg`} alt="" fill sizes="(max-width: 600px) 100vw, 500px" loading="eager" unoptimized /></div>
      <span className="ft-eyebrow">{test.category} / {test.questionCount} 题</span>
      <h1>{test.title}</h1><p className="ft-intro-subtitle">{test.subtitle}</p><p>{test.introduction}</p>
      {pets.length ? <div className="ft-pet-picker"><span>给谁测</span><div>{pets.map((pet) => <button type="button" className={petName === pet.name ? "active" : ""} key={pet.id} onClick={() => setPetName(pet.name)}>{pet.name}</button>)}</div></div> : null}
      <label className="ft-name-field">宠物名字<input value={petName} maxLength={24} onChange={(event) => setPetName(event.target.value)} placeholder="例如：年糕" /></label>
      <button className="ft-primary" type="button" onClick={start} disabled={busy}>{busy ? "准备中…" : "开始测试"} <span>→</span></button>
      <p className="ft-disclaimer">{test.disclaimer}</p>
    </section> : null}

    {view === "question" && test ? <section className={`ft-quiz ft-theme-${test.cover}`}>
      <div className="ft-quiz-top"><button type="button" onClick={() => questionIndex ? setQuestionIndex(questionIndex - 1) : setView("intro")}>← 上一题</button><span>{questionIndex + 1} / {test.questions.length}</span></div>
      <div className="ft-progress" role="progressbar" aria-valuenow={questionIndex + 1} aria-valuemin={1} aria-valuemax={test.questions.length}><span style={{ width: `${(questionIndex + 1) / test.questions.length * 100}%` }} /></div>
      <span className="ft-eyebrow">想想 {petName} 平时的样子</span>
      <h1>{test.questions[questionIndex].prompt}</h1>
      <div className="ft-choices">{test.questions[questionIndex].choices.map((choice, index) => <button type="button" key={choice} onClick={() => choose(index)} disabled={busy} aria-pressed={answers[questionIndex] === index}><span>{String.fromCharCode(65 + index)}</span>{choice}<b>→</b></button>)}</div>
      <p className="ft-quiz-hint">选最像它平时样子的答案就好。</p>
    </section> : null}

    {view === "thinking" && test ? <section className={`ft-thinking ft-theme-${test.cover}`} role="status" aria-live="polite">
      <div className="ft-thinking-mark" aria-hidden="true"><span>✳</span></div>
      <span className="ft-eyebrow">答案正在靠近</span>
      <h1>正在拼出 {petName} 的小答案</h1>
      <p>把你选的日常片段，轻轻放在一起。</p>
      <div className="ft-thinking-steps"><span>翻翻它的小习惯</span><span>看看你们的默契</span><span>装进一张结果卡</span></div>
      <div className="ft-thinking-progress" aria-hidden="true"><span /></div>
    </section> : null}

    {view === "result" && result ? <FunTestResultView result={result} onRetry={() => result && openTest(result.testId)} onDelete={removeResult} /> : null}
    {error ? <p className="ft-error" role="alert">{error}</p> : null}
  </main>;
}
