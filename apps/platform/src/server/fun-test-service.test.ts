import { beforeEach, describe, expect, it } from "vitest";

import { funTests, scoreFunTest } from "@/domain/fun-tests";
import { getDatabase, resetDatabaseForTest } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { createFunTestResult, deleteFunTestResult, getPublicFunTestResult, listFunTests, listMyFunTestResults, startFunTest } from "@/server/fun-test-service";

const owner = "00000000-0000-4000-8000-000000000051";
const stranger = "00000000-0000-4000-8000-000000000052";

describe("fun tests", () => {
  beforeEach(async () => {
    await resetDatabaseForTest();
    await (await getDatabase()).query("INSERT INTO users(id,created_at) VALUES ($1,now()),($2,now())", [owner, stranger]);
  });

  it("ships four distinct, complete 10-question tests with stable answers", () => {
    expect(listFunTests()).toHaveLength(4);
    expect(new Set(funTests.map((test) => test.category)).size).toBe(4);
    for (const test of funTests) {
      expect(test.questions).toHaveLength(10);
      expect(test.outcomes).toHaveLength(4);
      expect(new Set(test.questions.map((question) => question.prompt)).size).toBe(10);
      expect(test.questions.every((question) => question.choices.length === 3)).toBe(true);
      expect(test.outcomes.every((outcome) => outcome.description && outcome.typical && outcome.bond && outcome.closing && outcome.tip)).toBe(true);
      const answers = [0, 1, 2, 0, 1, 2, 0, 1, 2, 0];
      expect(scoreFunTest(test, answers)).toEqual(scoreFunTest(test, answers));
      expect(() => scoreFunTest(test, answers.slice(1))).toThrow("FUN_TEST_ANSWERS_INVALID");
      for (const outcome of test.outcomes) {
        const preferredAnswers = test.questions.map((question) => {
          const primary = question.choices.findIndex((choice) => choice.primary === outcome.id);
          if (primary >= 0) return primary;
          return question.choices.findIndex((choice) => choice.secondary === outcome.id);
        });
        expect(preferredAnswers.every((answer) => answer >= 0)).toBe(true);
        expect(scoreFunTest(test, preferredAnswers).id, `${test.id}/${outcome.id}`).toBe(outcome.id);
      }
    }
  });

  it("persists a result, exposes only a random share token, and revokes it on deletion", async () => {
    const answers = Array(10).fill(0);
    await startFunTest(owner, funTests[0].id);
    const result = await createFunTestResult(owner, funTests[0].id, { petName: " 年糕 ", answers });
    const events = await (await getDatabase()).query<{ name: string }>("SELECT name FROM events WHERE user_id=$1 AND name LIKE 'fun_test_%' ORDER BY created_at", [owner]);
    expect(events.map((event) => event.name)).toEqual(["fun_test_started", "fun_test_completed"]);
    expect(result.petName).toBe("年糕");
    expect(result.shareToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(result.outcome.name).toBeTruthy();
    expect(await getPublicFunTestResult(result.shareToken)).toEqual(result);
    expect((await listMyFunTestResults(owner)).map((item) => item.id)).toEqual([result.id]);
    expect(await listMyFunTestResults(stranger)).toEqual([]);
    await expect(deleteFunTestResult(stranger, result.id)).rejects.toBeInstanceOf(AppError);
    await deleteFunTestResult(owner, result.id);
    await expect(getPublicFunTestResult(result.shareToken)).rejects.toMatchObject({ status: 404 });
  });

  it("rejects incomplete submissions and hides results when the account is suspended", async () => {
    await expect(createFunTestResult(owner, funTests[1].id, { petName: "团子", answers: [0, 1] })).rejects.toBeTruthy();
    const result = await createFunTestResult(owner, funTests[1].id, { petName: "团子", answers: Array(10).fill(1) });
    await (await getDatabase()).query("UPDATE users SET admin_suspended_at=now() WHERE id=$1", [owner]);
    await expect(getPublicFunTestResult(result.shareToken)).rejects.toMatchObject({ status: 404 });
  });
});
