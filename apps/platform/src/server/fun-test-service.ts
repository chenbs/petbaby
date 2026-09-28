import "server-only";

import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";

import { findFunTest, funTests, publicFunTest, scoreFunTest } from "@/domain/fun-tests";
import { getDatabase } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { recordEvent } from "@/server/platform-service";

const submissionSchema = z.object({
  petName: z.string().trim().min(1, "请填写宠物名字").max(24, "名字最多 24 个字"),
  answers: z.array(z.number().int().min(0).max(2)),
});

type ResultRow = {
  id: string;
  test_id: string;
  pet_name: string;
  outcome_id: string;
  snapshot: unknown;
  share_token: string;
  created_at: string | Date;
};

function getTest(id: string) {
  const test = findFunTest(id);
  if (!test) throw new AppError("FUN_TEST_NOT_FOUND", "这份测试暂时不存在", 404);
  return test;
}

function decodeSnapshot(value: unknown) {
  const raw = typeof value === "string" ? JSON.parse(value) : value;
  return z.object({
    testTitle: z.string(), category: z.string(), cover: z.string(), disclaimer: z.string(),
    outcome: z.object({
      id: z.string(), name: z.string(), description: z.string(), typical: z.string(),
      bond: z.string(), closing: z.string(), keywords: z.array(z.string()), tip: z.string(),
    }),
  }).parse(raw);
}

function mapResult(row: ResultRow) {
  return {
    id: row.id,
    testId: row.test_id,
    petName: row.pet_name,
    outcomeId: row.outcome_id,
    shareToken: row.share_token,
    createdAt: new Date(row.created_at).toISOString(),
    ...decodeSnapshot(row.snapshot),
  };
}

export function listFunTests() {
  return funTests.map(({ id, title, subtitle, category, cover, questions }) => ({
    id, title, subtitle, category, cover, questionCount: questions.length,
  }));
}

export function getFunTest(id: string) {
  return publicFunTest(getTest(id));
}

export async function startFunTest(userId: string, id: string) {
  const test = getTest(id);
  await recordEvent(userId, "fun_test_started", test.id, "product");
  return { started: true };
}

export async function createFunTestResult(userId: string, id: string, input: unknown) {
  const test = getTest(id);
  const data = submissionSchema.extend({ answers: submissionSchema.shape.answers.length(test.questions.length) }).parse(input);
  const outcome = scoreFunTest(test, data.answers);
  const snapshot = { testTitle: test.title, category: test.category, cover: test.cover, disclaimer: test.disclaimer, outcome };
  const rows = await (await getDatabase()).query<ResultRow>(
    "INSERT INTO fun_test_results(id,user_id,test_id,pet_name,answers,outcome_id,snapshot,share_token,created_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8,now()) RETURNING id,test_id,pet_name,outcome_id,snapshot,share_token,created_at",
    [randomUUID(), userId, test.id, data.petName, JSON.stringify(data.answers), outcome.id, JSON.stringify(snapshot), randomBytes(24).toString("base64url")],
  );
  await recordEvent(userId, "fun_test_completed", test.id, "product", { resultId: rows[0].id, outcomeId: outcome.id });
  return mapResult(rows[0]);
}

export async function listMyFunTestResults(userId: string) {
  const rows = await (await getDatabase()).query<ResultRow>(
    "SELECT id,test_id,pet_name,outcome_id,snapshot,share_token,created_at FROM fun_test_results WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 30",
    [userId],
  );
  return rows.map(mapResult);
}

export async function getPublicFunTestResult(token: string) {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) throw new AppError("FUN_TEST_RESULT_NOT_FOUND", "分享链接无效", 404);
  const rows = await (await getDatabase()).query<ResultRow>(
    "SELECT r.id,r.test_id,r.pet_name,r.outcome_id,r.snapshot,r.share_token,r.created_at FROM fun_test_results r JOIN users u ON u.id=r.user_id WHERE r.share_token=$1 AND u.deleted_at IS NULL AND u.admin_suspended_at IS NULL",
    [token],
  );
  if (!rows[0]) throw new AppError("FUN_TEST_RESULT_NOT_FOUND", "这份测试结果已失效", 404);
  return mapResult(rows[0]);
}

export async function deleteFunTestResult(userId: string, id: string) {
  const rows = await (await getDatabase()).query<{ id: string }>(
    "DELETE FROM fun_test_results WHERE id=$1 AND user_id=$2 RETURNING id", [id, userId],
  );
  if (!rows[0]) throw new AppError("FUN_TEST_RESULT_NOT_FOUND", "这份测试结果不存在", 404);
  return { deleted: true };
}
