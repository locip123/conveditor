export type DrawingStage = 'sketch' | 'lineart' | 'color'
export type Region = { x: number; y: number; width: number; height: number }
export type Brief = { stage: DrawingStage; goal: string; preserve: string; region: Region | null }
export type Stroke = { points: number[]; color: string; width: number; tool: 'brush' | 'eraser' }
export type Drawing = { base: string | null; strokes: Stroke[] }
export type Suggestion = {
  id: string; title: string; priority: 'high' | 'medium' | 'low'
  observation: string; action: string; reason: string; region: Region | null
}
export type Evaluation = {
  id: string; summary: string; strengths: string[]; suggestions: Suggestion[]
  model: string; prompt_version: string
}
export type Candidate = {
  id: string; evaluation_id?: string | null; session_id?: string | null; image_url: string; model: string
  prompt: string; prompt_version: string; scope: 'instruction' | 'masked_region'
}
export type Revision = {
  id: string; name: string; createdAt: string; image: string; drawing: Drawing; brief: Brief
}
export type Workspace = { name: string; drawing: Drawing; brief: Brief; revisions: Revision[] }
export type Health = { configured: boolean; evaluation_model: string; image_edit_model: string }
export type RegionMessage = { role: 'user' | 'assistant'; content: string }
export type RegionMessageResponse = { reply: string; candidate: Candidate | null }
