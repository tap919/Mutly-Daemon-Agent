import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface GenerationFeedback {
  taskType: string;
  prompt: string;
  result: string;
  passed: boolean;
  testResults?: string;
  timestamp: number;
}

export class FeedbackLearner {
  private feedbackDir: string;
  private feedback: GenerationFeedback[] = [];

  constructor(dataDir?: string) {
    this.feedbackDir = join(dataDir || process.env.MUTLY_DATA_DIR || "./data", "feedback");
    this.load();
  }

  record(fb: GenerationFeedback): void {
    this.feedback.push(fb);
    if (this.feedback.length > 1000) {
      this.feedback = this.feedback.slice(-1000);
    }
    this.save();
  }

  getSuccessfulPatterns(taskType: string, limit = 5): GenerationFeedback[] {
    return this.feedback
      .filter((f) => f.taskType === taskType && f.passed)
      .slice(-limit);
  }

  getPromptAugmentation(taskType: string): string {
    const successes = this.getSuccessfulPatterns(taskType, 3);
    if (successes.length === 0) return "";

    const examples = successes
      .map((s) => `Example of a successful ${taskType}:\n${s.result.slice(0, 500)}`)
      .join("\n\n");

    return `\n\nHere are examples of successful ${taskType}s from past generations:\n${examples}\n\nFollow these patterns.`;
  }

  getSuccessRate(taskType: string): { total: number; passed: number; rate: number } {
    const all = this.feedback.filter((f) => f.taskType === taskType);
    const passed = all.filter((f) => f.passed).length;
    return {
      total: all.length,
      passed,
      rate: all.length > 0 ? passed / all.length : 0,
    };
  }

  private save(): void {
    if (!existsSync(this.feedbackDir)) {
      mkdirSync(this.feedbackDir, { recursive: true });
    }
    writeFileSync(join(this.feedbackDir, "feedback.json"), JSON.stringify(this.feedback, null, 2), "utf-8");
  }

  private load(): void {
    const p = join(this.feedbackDir, "feedback.json");
    if (existsSync(p)) {
      try {
        this.feedback = JSON.parse(readFileSync(p, "utf-8"));
      } catch {
        // corrupted file — start fresh
      }
    }
  }
}

export const feedbackLearner = new FeedbackLearner();
