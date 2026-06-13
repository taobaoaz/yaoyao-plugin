/**
 * core/benchmark/cases.ts — Yaoyao benchmark test cases.
 */
export const YAoyao_BENCHMARK_CASES = [
    // === Single-hop (直接事实检索) ===
    {
        id: "sh-001",
        name: "User preference retrieval",
        description: "Retrieve a specific user preference mentioned earlier",
        category: "single-hop",
        conversation: [
            "User: I prefer dark mode for all my applications.",
            "AI: Noted. I'll remember you prefer dark mode.",
            "User: What did we discuss about UI preferences?",
        ],
        question: "What UI preference does the user have?",
        expectedAnswer: "dark mode",
        difficulty: "easy",
    },
    {
        id: "sh-002",
        name: "Project name recall",
        description: "Recall a project name mentioned in conversation",
        category: "single-hop",
        conversation: [
            "User: I'm working on a project called 'yaoyao-memory'.",
            "AI: Great, I'll remember you're working on yaoyao-memory.",
            "User: What's the name of my current project?",
        ],
        question: "What is the name of the user's current project?",
        expectedAnswer: "yaoyao-memory",
        difficulty: "easy",
    },
    // === Multi-hop (多跳推理) ===
    {
        id: "mh-001",
        name: "Indirect relationship",
        description: "Connect two pieces of information through intermediate facts",
        category: "multi-hop",
        conversation: [
            "User: My boss is John Smith.",
            "AI: Noted. John Smith is your boss.",
            "User: John Smith works in the Engineering department.",
            "AI: Noted. John Smith is in Engineering.",
            "User: Which department does my boss work in?",
        ],
        question: "Which department does the user's boss work in?",
        expectedAnswer: "Engineering",
        difficulty: "medium",
    },
    {
        id: "mh-002",
        name: "Tool preference chain",
        description: "Track tool preferences through multiple contexts",
        category: "multi-hop",
        conversation: [
            "User: For coding, I use VS Code.",
            "AI: Noted. VS Code for coding.",
            "User: For Python projects, I need a linter.",
            "AI: Noted. Python linter needed.",
            "User: I configured pylint for my Python projects in VS Code.",
            "AI: Noted. pylint configured for Python in VS Code.",
            "User: What linter do I use for Python?",
        ],
        question: "What linter does the user use for Python?",
        expectedAnswer: "pylint",
        difficulty: "hard",
    },
    // === Temporal (时序) ===
    {
        id: "tp-001",
        name: "Recent event",
        description: "Recall the most recent event",
        category: "temporal",
        conversation: [
            "User: [2024-01-15] I started learning Rust.",
            "AI: Noted. Started learning Rust on 2024-01-15.",
            "User: [2024-03-20] I completed my Rust project.",
            "AI: Noted. Completed Rust project on 2024-03-20.",
            "User: [2024-06-01] I started learning Go.",
            "AI: Noted. Started learning Go on 2024-06-01.",
            "User: What did I most recently start learning?",
        ],
        question: "What did the user most recently start learning?",
        expectedAnswer: "Go",
        difficulty: "medium",
    },
    {
        id: "tp-002",
        name: "Event sequence",
        description: "Recall the sequence of events",
        category: "temporal",
        conversation: [
            "User: First, I designed the database schema.",
            "AI: Noted. Database schema designed first.",
            "User: Then, I implemented the API endpoints.",
            "AI: Noted. API endpoints implemented second.",
            "User: Finally, I wrote the frontend components.",
            "AI: Noted. Frontend components written third.",
            "User: What was the second step in my development process?",
        ],
        question: "What was the second step in the user's development process?",
        expectedAnswer: "API endpoints",
        difficulty: "medium",
    },
    // === Open-domain (开放域) ===
    {
        id: "od-001",
        name: "General knowledge synthesis",
        description: "Synthesize information from multiple contexts",
        category: "open-domain",
        conversation: [
            "User: I like functional programming.",
            "AI: Noted. Preference for functional programming.",
            "User: Haskell has great type safety.",
            "AI: Noted. Haskell type safety appreciated.",
            "User: I use monads in my projects.",
            "AI: Noted. Monads used in projects.",
            "User: What programming paradigm do I prefer and why?",
        ],
        question: "What programming paradigm does the user prefer and why?",
        expectedAnswer: "functional",
        difficulty: "hard",
    },
];
export function getBenchmarkSuite() {
    return {
        name: "yaoyao-memory-benchmark",
        cases: YAoyao_BENCHMARK_CASES,
        metadata: {
            version: "1.0.0",
            createdAt: Date.now(),
            totalCases: YAoyao_BENCHMARK_CASES.length,
        },
    };
}
