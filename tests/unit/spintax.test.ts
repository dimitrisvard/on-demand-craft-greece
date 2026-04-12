import { describe, it, expect } from '@jest/globals';
import { parseSpintax, replaceTemplateVariables, processEmailContent } from '../../src/utils/spintax';

describe('Spintax Parser', () => {
  it('should return plain text unchanged', () => {
    expect(parseSpintax('Hello world')).toBe('Hello world');
  });

  it('should pick one option from a spintax group', () => {
    const options = ['Hi', 'Hello', 'Hey'];
    const result = parseSpintax('{Hi|Hello|Hey}');
    expect(options).toContain(result);
  });

  it('should handle multiple spintax groups', () => {
    const result = parseSpintax('{Hi|Hello} {world|there}');
    // Result should be one of: "Hi world", "Hi there", "Hello world", "Hello there"
    expect(result).toMatch(/^(Hi|Hello) (world|there)$/);
  });

  it('should return empty-ish for empty input', () => {
    expect(parseSpintax('')).toBe('');
  });

  it('should handle text without spintax braces', () => {
    const text = 'No spintax here at all';
    expect(parseSpintax(text)).toBe(text);
  });
});

describe('Template Variable Replacement', () => {
  it('should replace template variables', () => {
    const result = replaceTemplateVariables('Hello {{name}}, welcome to {{company}}', {
      name: 'Dimitris',
      company: 'Microns Hub',
    });
    expect(result).toBe('Hello Dimitris, welcome to Microns Hub');
  });

  it('should handle missing variables gracefully', () => {
    const result = replaceTemplateVariables('Hello {{name}}', {});
    // Unmatched template vars stay as-is (no variable to replace with)
    expect(result).toBe('Hello {{name}}');
  });

  it('should return empty text unchanged', () => {
    expect(replaceTemplateVariables('', { name: 'test' })).toBe('');
  });

  it('should be case-insensitive for variable names', () => {
    const result = replaceTemplateVariables('Hello {{Name}}', { Name: 'Dimitris' });
    expect(result).toBe('Hello Dimitris');
  });
});

describe('Email Content Processing', () => {
  it('should apply both spintax and template variables', () => {
    const result = processEmailContent('{Dear|Hello} {{name}}', { name: 'Dimitris' });
    expect(result).toMatch(/^(Dear|Hello) Dimitris$/);
  });

  it('should handle empty input', () => {
    expect(processEmailContent('')).toBe('');
  });
});
