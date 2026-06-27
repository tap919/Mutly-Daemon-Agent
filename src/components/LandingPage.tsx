import { motion } from "motion/react";
import {
  Dog,
  Terminal,
  ArrowRight,
  Shield,
  Database,
  Moon,
  Workflow,
  FileCode2,
} from "lucide-react";

export default function LandingPage({ onEnter }: { onEnter: () => void }) {
  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.1 },
    },
  } as const;

  const item = {
    hidden: { opacity: 0, y: 20 },
    show: {
      opacity: 1,
      y: 0,
      transition: { type: "spring" as const, stiffness: 300, damping: 24 },
    },
  } as const;

  const fadeInUp = {
    hidden: { opacity: 0, y: 20 },
    show: {
      opacity: 1,
      y: 0,
      transition: { type: "spring" as const, stiffness: 300, damping: 24 },
    },
  } as const;

  const scaleIn = {
    hidden: { opacity: 0, scale: 0.8 },
    show: {
      opacity: 1,
      scale: 1,
      transition: { type: "spring" as const, stiffness: 300, damping: 24 },
    },
  } as const;

  const slideInLeft = {
    hidden: { opacity: 0, x: -20 },
    show: {
      opacity: 1,
      x: 0,
      transition: { type: "spring" as const, stiffness: 300, damping: 24 },
    },
  } as const;

  const slideInRight = {
    hidden: { opacity: 0, x: 20 },
    show: {
      opacity: 1,
      x: 0,
      transition: { type: "spring" as const, stiffness: 300, damping: 24 },
    },
  } as const;

  const staggerItem = {
    hidden: { opacity: 0, y: 20 },
    show: {
      opacity: 1,
      y: 0,
      transition: { type: "spring" as const, stiffness: 300, damping: 24 },
    },
  } as const;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 font-sans selection:bg-indigo-500/30 overflow-x-hidden">
      {/* Background Grid */}
      <div className="fixed inset-0 z-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]">
        <div className="absolute left-0 right-0 top-0 -z-10 m-auto h-[400px] w-[600px] rounded-full bg-indigo-500 opacity-20 blur-[120px]"></div>
        <div className="absolute bottom-0 right-[-10%] -z-10 h-[300px] w-[500px] rounded-full bg-emerald-500 opacity-10 blur-[100px]"></div>
      </div>

      <nav className="relative z-50 border-b border-zinc-800/50 bg-zinc-950/50 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 font-display font-semibold tracking-tight text-xl">
            <Dog className="text-indigo-500 w-6 h-6" />
            <span>
              Mutly<span className="text-zinc-500">Daemon</span>
            </span>
          </div>
          <div className="flex items-center gap-6 text-sm font-medium">
            <button
              onClick={onEnter}
              className="bg-zinc-100 text-zinc-950 px-4 py-2 rounded shadow-sm hover:bg-white transition-colors flex items-center gap-2 font-semibold"
            >
              Launch Console <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </nav>

      <main className="relative z-10 pt-32 pb-20 px-6 max-w-7xl mx-auto">
        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          className="flex flex-col items-center text-center max-w-4xl mx-auto"
        >
          <motion.div
            variants={item}
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-indigo-400 text-xs font-mono mb-8"
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
            </span>
            MUTLY DAEMON ONLINE
          </motion.div>

          <motion.h1
            variants={item}
            className="text-5xl md:text-7xl font-display font-bold tracking-tighter leading-[1.1]"
          >
            Deterministic AI for <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-indigo-400 to-purple-400">
              Stateful Engineering.
            </span>
          </motion.h1>

          <motion.p
            variants={item}
            className="mt-6 text-lg md:text-xl text-zinc-400 max-w-2xl text-center"
          >
            A minimalist, deterministic approach with long-context reasoning for
            drift-free agentic workflows.
          </motion.p>

          <motion.div
            variants={item}
            className="mt-10 flex flex-col sm:flex-row items-center gap-4"
          >
            <button
              onClick={onEnter}
              className="bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-3 rounded-md text-sm font-medium transition-colors flex items-center gap-2 w-full sm:w-auto justify-center"
            >
              Enter Command Center <ArrowRight className="w-4 h-4" />
            </button>
            <button className="bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 px-8 py-3 rounded-md text-sm font-medium transition-colors flex items-center gap-2 w-full sm:w-auto justify-center">
              <Terminal className="w-4 h-4" /> Read SPEC.md
            </button>
          </motion.div>
        </motion.div>

        <motion.div
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-100px" }}
          className="mt-32 grid grid-cols-1 md:grid-cols-3 gap-6"
        >
          <motion.div
            variants={item}
            className="md:col-span-2 border border-zinc-800 bg-zinc-900/40 backdrop-blur-sm rounded-2xl p-8 relative overflow-hidden group hover:border-indigo-500/50 transition-colors"
          >
            <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
              <Workflow className="w-48 h-48 text-indigo-500" />
            </div>
            <Workflow className="w-8 h-8 text-indigo-400 mb-6" />
            <h3 className="text-2xl font-display font-semibold text-zinc-100 mb-2">
              Streamlined REPL Architecture
            </h3>
            <p className="text-zinc-400 max-w-md">
              Shifting from sluggish, multi-agent swarms to a lightning-fast, highly optimized single-threaded Read-Eval-Print Loop for sub-minute execution speeds.
            </p>
            <ul className="mt-6 space-y-3 font-mono text-xs text-zinc-500">
              <li className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-400"></div>{" "}
                Strict Hardcoded Tool Boundaries
              </li>
              <li className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-400"></div>{" "}
                Native Grep & AST Dependency Parsing
              </li>
            </ul>
          </motion.div>

          <motion.div
            variants={item}
            className="border border-zinc-800 bg-zinc-900/40 backdrop-blur-sm rounded-2xl p-8 group hover:border-emerald-500/50 transition-colors"
          >
            <Database className="w-8 h-8 text-emerald-400 mb-6" />
            <h3 className="text-xl font-display font-semibold text-zinc-100 mb-2">
              Atomic Rollbacks
            </h3>
            <p className="text-sm text-zinc-400">
              Fault-tolerant execution loop with atomic state transitions, preventing corrupted or half-updated repositories on failure.
            </p>
          </motion.div>

          <motion.div
            variants={item}
            className="border border-zinc-800 bg-zinc-900/40 backdrop-blur-sm rounded-2xl p-8 group hover:border-purple-500/50 transition-colors"
          >
            <Moon className="w-8 h-8 text-purple-400 mb-6" />
            <h3 className="text-xl font-display font-semibold text-zinc-100 mb-2">
              Token Compaction
            </h3>
            <p className="text-sm text-zinc-400">
              Internalized Message Compaction Engine with Snip Compact, Microcompact, and Context Collapse preserving prompt-cache layout.
            </p>
          </motion.div>

          <motion.div
            variants={item}
            className="md:col-span-2 border border-zinc-800 bg-zinc-900/40 backdrop-blur-sm rounded-2xl p-8 flex flex-col md:flex-row gap-8 items-center group hover:border-amber-500/50 transition-colors"
          >
            <div className="flex-1">
              <Shield className="w-8 h-8 text-amber-400 mb-6" />
              <h3 className="text-2xl font-display font-semibold text-zinc-100 mb-2">
                Secure Sandbox
              </h3>
              <p className="text-zinc-400">
                gRPC-connected WASM sandboxes allowing agents to run `npm run
                build` and test frameworks securely.
              </p>
            </div>
            <div className="flex-1 w-full bg-zinc-950 border border-zinc-800 rounded-lg p-4 font-mono text-xs text-zinc-500 shadow-xl">
              <div className="flex items-center gap-2 mb-3 px-2 border-b border-zinc-800 pb-2">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500/80"></span>
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80"></span>
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80"></span>
              </div>
              <div className="text-amber-400 mb-1">systemd/mutly.service</div>
              <div className="text-zinc-300">
                $ run-sandbox --eval "tsc --noEmit"
              </div>
              <div className="text-emerald-400 mt-3">
                ✓ Zero-Trust Isolation Enabled
              </div>
              <div className="text-emerald-400 mt-1">✓ Syntax Confirmed</div>
            </div>
          </motion.div>

          <motion.div
            variants={item}
            className="md:col-span-3 border border-zinc-800 bg-zinc-900/40 backdrop-blur-sm rounded-2xl p-8 flex items-center gap-6 group hover:border-blue-500/50 transition-colors"
          >
            <div className="bg-zinc-950 p-4 rounded-full border border-zinc-800 flex-shrink-0">
              <FileCode2 className="w-6 h-6 text-blue-400" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-display font-semibold text-zinc-100">
                Markdown-Driven Source of Truth
              </h3>
              <p className="text-sm text-zinc-400 mt-1">
                Constraining agentic hallucination by anchoring behavior
                absolutely to SPEC.md and CLAUDE.md structural guardrails.
              </p>
            </div>
          </motion.div>
        </motion.div>
      </main>

      <footer className="relative z-10 border-t border-zinc-800/50 py-12 text-center text-xs font-mono text-zinc-500 bg-zinc-950/80 backdrop-blur">
        <p>Protocol Initialized. Awaiting Director Input.</p>
      </footer>
    </div>
  );
}
