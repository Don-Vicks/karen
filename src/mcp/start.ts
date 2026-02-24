#!/usr/bin/env node

// ============================================
// MCP Entry Point
// ============================================
// Standalone script that always starts the MCP server.
// Used by Claude Desktop and other MCP clients.
//
// Config: claude_desktop_config.json → "args": ["tsx", ".../src/mcp/start.ts"]

import dotenv from 'dotenv'
import path from 'path'

// Resolve .env relative to project root (2 levels up from src/mcp/)
dotenv.config({ path: path.resolve(__dirname, '../../.env') })

import { startMCPServer } from './server'

startMCPServer().catch((err) => {
  console.error('MCP server failed to start:', err)
  process.exit(1)
})
