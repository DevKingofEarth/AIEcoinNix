import { tool } from "@opencode-ai/plugin"
import { exec } from "child_process"
import { promisify } from "util"

const execAsync = promisify(exec)

export default tool({
  description: `Extract YouTube video transcripts using yt-dlp.

  **Usage:**
  - Get transcript: @yt-transcript url='https://youtube.com/watch?v=xxx'
  - Specific language: @yt-transcript url='...' lang='en'
  
  **Features:**
  - Uses yt-dlp for transcript extraction
  - Supports multiple languages
  - Returns formatted transcript text
  - Requires yt-dlp to be installed`,
  
  args: {
    url: tool.schema.string().describe("YouTube video URL"),
    lang: tool.schema.string().optional().describe("Language code (e.g., 'en', 'es', 'auto')"),
  },
  
  async execute(args) {
    const { url, lang } = args
    
    try {
      // Build yt-dlp command
      let cmd = `yt-dlp --write-auto-sub --sub-lang ${lang || 'en'} --skip-download --convert-subs srt --output /tmp/ytdlp_transcript.%(ext)s "${url}"`
      
      // Execute yt-dlp
      const { stdout, stderr } = await execAsync(cmd, { timeout: 60000 })
      
      if (stderr && stderr.includes("WARNING")) {
        // Warnings are okay, continue
      }
      
      // Read the generated subtitle file
      const fs = await import('fs')
      const srtPath = '/tmp/ytdlp_transcript.srt'
      
      if (fs.existsSync(srtPath)) {
        const srtContent = fs.readFileSync(srtPath, 'utf-8')
        const transcript = convertSrtToText(srtContent)
        
        // Clean up
        fs.unlinkSync(srtPath)
        
        return `**YouTube Transcript**

**URL:** ${url}
**Language:** ${lang || 'auto'}

${transcript}

---
*Extracted using yt-dlp*`
      }
      
      // Try to get transcript directly
      const directCmd = `yt-dlp --get-transcript ${lang ? `--sub-lang ${lang}` : ''} --skip-download "${url}"`
      const directResult = await execAsync(directCmd, { timeout: 60000 })
      
      return `**YouTube Transcript**

**URL:** ${url}
**Language:** ${lang || 'auto'}

${directResult.stdout}

---
*Extracted using yt-dlp*`
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      
      if (errorMessage.includes('no subtitles')) {
        return `**YouTube Transcript - No Subtitles Found**

**URL:** ${url}

This video does not have subtitles available in ${lang || 'the default language'}.

**Options:**
1. Try different language: lang='en', lang='es', etc.
2. Video may not have captions
3. Video may be region-restricted`
      }
      
      if (errorMessage.includes('Video unavailable')) {
        return `**YouTube Transcript - Video Unavailable**

**URL:** ${url}

This video is unavailable or has been removed.

**Check:**
1. URL is correct
2. Video exists
3. Video is not private/deleted`
      }
      
      return `**YouTube Transcript - Error**

**URL:** ${url}
**Error:** ${errorMessage}

**Troubleshooting:**
1. Verify URL is correct
2. Check video has subtitles
3. Ensure yt-dlp is installed: \`which yt-dlp\``
    }
  }
})

function convertSrtToText(srt: string): string {
  // Remove SRT formatting (numbers, timestamps)
  const lines = srt.split('\n')
  const textLines: string[] = []
  
  for (const line of lines) {
    const trimmed = line.trim()
    // Skip empty lines, numbers, and timestamps
    if (!trimmed || /^\d+$/.test(trimmed) || /\d{2}:\d{2}:\d{2}/.test(trimmed)) {
      continue
    }
    // Remove HTML tags
    const clean = trimmed.replace(/<[^>]*>/g, '')
    if (clean) {
      textLines.push(clean)
    }
  }
  
  return textLines.join(' ').replace(/\s+/g, ' ').trim()
}
