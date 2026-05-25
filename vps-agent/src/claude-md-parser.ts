export interface ParsedInstructions {
  commands: string[];
  working_directory?: string;
  error?: string;
}

interface Section {
  heading: string;
  level: number;
  content: string;
}

function parseSections(md: string): Section[] {
  const lines = md.split('\n');
  const sections: Section[] = [];
  let current: Section | null = null;
  const contentLines: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      if (current) {
        current.content = contentLines.splice(0).join('\n');
        sections.push(current);
      }
      current = { heading: headingMatch[2], level: headingMatch[1].length, content: '' };
    } else if (current) {
      contentLines.push(line);
    }
  }
  if (current) {
    current.content = contentLines.join('\n');
    sections.push(current);
  }
  return sections;
}

function isDeployHeading(heading: string): boolean {
  return /deploy|deployment|vps/i.test(heading);
}

function extractBashCommands(content: string): string[] {
  const commands: string[] = [];
  const codeBlockRegex = /```bash\n([\s\S]*?)```/g;
  let match;
  while ((match = codeBlockRegex.exec(content)) !== null) {
    const block = match[1];
    // Join continuation lines, then split
    const joined = block.replace(/\\\n/g, '');
    for (const line of joined.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        commands.push(trimmed);
      }
    }
  }
  return commands;
}

function extractWorkingDir(md: string): string | undefined {
  const match = md.match(/(?:Project dir|project at)[:\s]*`([^`]+)`/i);
  return match?.[1];
}

export function parseDeployInstructions(claudeMd: string, operation: string): ParsedInstructions {
  const sections = parseSections(claudeMd);
  const deploySections = sections.filter(s => isDeployHeading(s.heading));

  if (deploySections.length === 0) {
    return { commands: [], error: 'No deployment section found in CLAUDE.md' };
  }

  // For parent deploy sections, include child sections' content
  // Build full content per top-level deploy section including its children
  let targetSections: Section[];

  if (operation === 'frontend') {
    // Prefer sections with "frontend" in heading
    const frontendSections = deploySections.filter(s => /frontend/i.test(s.heading));
    targetSections = frontendSections.length > 0 ? frontendSections : deploySections;
  } else {
    targetSections = deploySections;
  }

  const commands: string[] = [];
  for (const section of targetSections) {
    commands.push(...extractBashCommands(section.content));
  }

  const working_directory = extractWorkingDir(claudeMd);

  return {
    commands,
    ...(working_directory && { working_directory }),
  };
}
