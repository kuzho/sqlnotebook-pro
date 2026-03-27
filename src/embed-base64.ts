import * as fs from 'fs';
import * as path from 'path';

/**
 * Replace all image paths in markdown with base64 data URIs if possible.
 * Only replaces ![...](...) where the path is a local file and not already base64.
 */
export type EmbedImagesResult = {
  markdown: string;
  embeddedFiles: string[];
};

const embeddedImageCache = new Map<string, string>();

function shouldSkipPath(imagePath: string): boolean {
  return /^data:image\//i.test(imagePath)
    || /^attachment:/i.test(imagePath)
    || /^(https?:|vscode-|file:)/i.test(imagePath);
}

function getMimeFromFilePath(filePath: string): string {
  const ext = (filePath.split('.').pop() || 'png').toLowerCase();
  if (ext === 'jpg') {
    return 'jpeg';
  }
  return ext;
}

export async function embedImagesAsBase64(markdown: string, notebookDir?: string): Promise<EmbedImagesResult> {
  const regex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const uniqueLocalPaths = new Set<string>();
  const resolvedDataByInputPath = new Map<string, string>();
  const embeddedFiles = new Set<string>();

  markdown.replace(regex, (_full, _alt, rawPath) => {
    const imagePath = String(rawPath).trim();
    if (!shouldSkipPath(imagePath)) {
      uniqueLocalPaths.add(imagePath);
    }
    return _full;
  });

  const readPromises = [...uniqueLocalPaths].map(async (imagePath) => {
    let resolvedPath = imagePath;
    if (notebookDir && !path.isAbsolute(resolvedPath)) {
      resolvedPath = path.join(notebookDir, resolvedPath);
    }
    const absolutePath = path.resolve(resolvedPath);

    const cached = embeddedImageCache.get(absolutePath);
    if (cached) {
      resolvedDataByInputPath.set(imagePath, cached);
      return;
    }

    try {
      const data = await fs.promises.readFile(resolvedPath);
      const mime = getMimeFromFilePath(resolvedPath);
      const base64 = `data:image/${mime};base64,${data.toString('base64')}`;
      resolvedDataByInputPath.set(imagePath, base64);
      embeddedImageCache.set(absolutePath, base64);
      embeddedFiles.add(absolutePath);
    } catch {
      // Keep original markdown path when the source file is not readable.
    }
  });

  await Promise.all(readPromises);

  const result = markdown.replace(regex, (full, alt, rawPath) => {
    const imagePath = String(rawPath).trim();
    const base64 = resolvedDataByInputPath.get(imagePath);
    if (!base64) {
      return full;
    }
    return `![${alt}](${base64})`;
  });

  return {
    markdown: result,
    embeddedFiles: [...embeddedFiles]
  };
}
