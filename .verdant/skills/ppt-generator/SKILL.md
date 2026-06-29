---
name: ppt-generator
description: Generate professional PowerPoint presentations using python-pptx. Use when the user wants to create PPT files with specific content, themes, or layouts.
---

# PPT Generator Skill

## Prerequisites
- Ensure `python-pptx` is installed: `pip3 install python-pptx`
- All intermediate files go to `/tmp/`
- Final PPT goes to the user's specified directory (default: `~/Downloads/`)

## Standard PPT Structure
1. **Cover slide**: Title + subtitle + date
2. **Table of contents**: List of sections
3. **Content slides**: One topic per slide, 3-5 bullet points
4. **Summary slide**: Key takeaways
5. **Thank you slide**: Contact info or Q&A

## Design Guidelines
- 16:9 aspect ratio (13.333 x 7.5 inches)
- Title font: 28-36pt bold
- Body font: 16-20pt
- Max 6 bullet points per slide
- Use consistent color scheme throughout

## Color Palettes

### Professional Dark
- Background: #1a1a2e
- Primary: #16213e
- Accent: #e94560

### Clean Light
- Background: #f5f5f5
- Primary: #2c3e50
- Accent: #3498db

### Warm Earth
- Background: #fff8f0
- Primary: #8b4513
- Accent: #cd853f

## Parallel Generation
For large PPTs (10+ pages), use the `task` tool to parallelize:
1. Create outline → `/tmp/outline.json`
2. Spawn N workers (one per page or group) → `/tmp/page_N.json`
3. Assemble PPT from `/tmp/page_*.json` files
4. Clean up `/tmp/` files

## Verification
After generating:
- Check file exists and size > 0
- Open with python-pptx and verify slide count
- Check each slide has non-empty text
