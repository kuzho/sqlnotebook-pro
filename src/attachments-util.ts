/**
 * Extracts images from markdown as attachments and rewrites the markdown to use attachment links.
 * Returns: { markdown: string, attachments: { [filename: string]: { [mime: string]: string } } }
 */
export function extractAttachmentsFromMarkdown(markdown: string): { markdown: string, attachments: Record<string, Record<string, string>> } {
  const regex = /!\[([^\]]*)\]\((data:image\/(png|jpeg|jpg|gif|webp);base64,([^\)]+))\)/g;
  let match: RegExpExecArray | null;
  let result = markdown;
  const attachments: Record<string, Record<string, string>> = {};
  let imgCount = 1;

  const sanitize = (name: string): string => {
    const cleaned = (name || 'image').replace(/[\\/:*?"<>|\s]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    return cleaned || 'image';
  };

  const nextAvailableName = (baseName: string, ext: string): string => {
    let i = 1;
    let candidate = `${baseName}.${ext}`;
    while (attachments[candidate]) {
      i++;
      candidate = `${baseName}-${i}.${ext}`;
    }
    return candidate;
  };

  while ((match = regex.exec(markdown)) !== null) {
    const alt = match[1] || `image${imgCount}`;
    const mime = `image/${match[3]}`;
    const base64 = match[4];
    const filename = nextAvailableName(sanitize(alt), match[3]);
    attachments[filename] = { [mime]: base64 };
    // Replace with attachment link
    result = result.replace(match[0], `![${alt}](attachment:${filename})`);
    imgCount++;
  }
  return { markdown: result, attachments };
}

/**
 * Rewrites markdown to use base64 data URIs from attachments.
 * Used for rendering or exporting to other formats.
 */
export function injectAttachmentsIntoMarkdown(markdown: string, attachments: Record<string, Record<string, string>>): string {
  return markdown.replace(/!\[([^\]]*)\]\(attachment:([^\)]+)\)/g, (full, alt, filename) => {
    const att = attachments[filename];
    if (!att) {return full;}
    const mime = Object.keys(att)[0];
    const base64 = att[mime];
    return `![${alt}](data:${mime};base64,${base64})`;
  });
}
