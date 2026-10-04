import { describe, expect, it } from "vitest";
import { chunkText, extractText, htmlToText } from "./documents";

describe("chunkText", () => {
  it("keeps paragraphs together up to the target size", () => {
    const text = ["Uno.", "Dos.", "Tres."].join("\n\n");
    expect(chunkText(text, { targetChars: 1000 })).toEqual(["Uno.\n\nDos.\n\nTres."]);
  });

  it("splits long texts with overlap and never exceeds the maximum", () => {
    const paragraph = "Frase de prueba con varias palabras. ".repeat(40);
    const chunks = chunkText(`${paragraph}\n\n${paragraph}`, { targetChars: 500, maxChars: 600, overlapChars: 80 });
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(600 + 80 + 2);
  });
});

describe("extractText", () => {
  it("reads markdown and HTML", async () => {
    expect(await extractText(Buffer.from("# Título\n\nTexto"), "a.md")).toBe("# Título\n\nTexto");
    expect(htmlToText("<p>Hola <b>mundo</b></p><script>x()</script><p>Adiós&nbsp;ya</p>")).toBe("Hola mundo\n\nAdiós ya");
  });

  it("rejects unsupported formats", async () => {
    await expect(extractText(Buffer.from(""), "a.exe")).rejects.toThrow(/no soportado/);
  });
});
