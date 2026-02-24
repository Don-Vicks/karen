import fs from 'fs'
import path from 'path'

// ============================================
// Agent Memory Store
// ============================================
// Persistent JSON-based memory for each agent
// Enables LLMs to reference past decisions and learn from outcomes

const MEMORY_DIR = path.resolve(process.cwd(), 'data', 'memory')

export interface MemoryEntry {
  cycle: number
  reasoning: string
  action: string | null
  outcome: string
  timestamp: string
}

export class MemoryStore {
  private memoryDir: string

  constructor(memoryDir?: string) {
    this.memoryDir = memoryDir || MEMORY_DIR
    if (!fs.existsSync(this.memoryDir)) {
      fs.mkdirSync(this.memoryDir, { recursive: true })
    }
  }

  /**
   * Store a memory entry for an agent
   */
  addMemory(agentId: string, entry: MemoryEntry): void {
    const memories = this.getMemories(agentId)
    memories.push(entry)

    // Keep only last 100 memories to avoid context bloat
    const trimmed = memories.slice(-100)
    const filepath = this.getFilepath(agentId)
    fs.writeFileSync(filepath, JSON.stringify(trimmed, null, 2))
  }

  /**
   * Get recent memories for context injection
   */
  getMemories(agentId: string, limit?: number): MemoryEntry[] {
    const filepath = this.getFilepath(agentId)
    if (!fs.existsSync(filepath)) return []

    const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'))
    if (limit) return data.slice(-limit)
    return data
  }

  /**
   * Format memories as context string for the LLM
   */
  formatForContext(agentId: string, limit: number = 10): string {
    const memories = this.getMemories(agentId, limit)
    if (memories.length === 0) return 'No previous actions recorded.'

    return memories
      .map((m) => {
        const action = m.action || 'wait'
        return `[Cycle ${m.cycle}] Action: ${action} | Reasoning: ${m.reasoning} | Outcome: ${m.outcome}`
      })
      .join('\n')
  }

  /**
   * Clear all memories for an agent
   */
  clear(agentId: string): void {
    const filepath = this.getFilepath(agentId)
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath)
    }
  }

  private getFilepath(agentId: string): string {
    return path.join(this.memoryDir, `${agentId}.json`)
  }
}
