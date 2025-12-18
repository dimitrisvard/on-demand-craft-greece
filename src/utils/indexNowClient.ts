/**
 * IndexNow Protocol Client
 * 
 * Implements the IndexNow protocol for notifying search engines
 * (Microsoft Bing, Yandex, Seznam, Naver) about URL updates.
 * 
 * Reference: https://www.indexnow.org/
 */

export interface IndexNowOptions {
  key?: string; // IndexNow API key (defaults to generating one)
  keyLocation?: string; // URL where key file is hosted (e.g., /indexnow_key.txt)
  host?: string; // Hostname for the key file location
}

/**
 * Generates a random IndexNow API key
 * The key should be between 8-128 characters, alphanumeric
 */
export const generateIndexNowKey = (): string => {
  const length = 32;
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

/**
 * Submits URLs to IndexNow protocol endpoint
 * 
 * @param urls Array of absolute URLs to index
 * @param options Configuration options
 * @returns Promise resolving to success status
 */
export const submitToIndexNow = async (
  urls: string[],
  options: IndexNowOptions = {}
): Promise<{ success: boolean; error?: string }> => {
  try {
    // Generate or use provided key
    const key = options.key || generateIndexNowKey();
    
    // IndexNow endpoint (Bing is the primary endpoint)
    const endpoint = 'https://www.bing.com/indexnow';
    
    // Prepare the request body
    const body = {
      host: options.host || new URL(urls[0]).hostname,
      key: key,
      keyLocation: options.keyLocation || `https://${options.host || new URL(urls[0]).hostname}/indexnow_key.txt`,
      urlList: urls,
    };

    // Submit to IndexNow
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`IndexNow submission failed: ${response.status} ${errorText}`);
    }

    return { success: true };
  } catch (error: any) {
    console.error('IndexNow submission error:', error);
    return {
      success: false,
      error: error.message || 'Unknown error',
    };
  }
};

/**
 * Creates the indexnow_key.txt file content
 * This file should be placed in the public root of the website
 * 
 * @param key The IndexNow API key
 * @returns The file content as a string
 */
export const createIndexNowKeyFile = (key: string): string => {
  return key;
};

/**
 * Validates that IndexNow is properly configured
 * Checks if the key file exists at the expected location
 * 
 * @param host The hostname to check
 * @param keyLocation The expected key file location
 * @returns Promise resolving to validation result
 */
export const validateIndexNowSetup = async (
  host: string,
  keyLocation: string = '/indexnow_key.txt'
): Promise<{ valid: boolean; error?: string }> => {
  try {
    const keyUrl = `https://${host}${keyLocation}`;
    const response = await fetch(keyUrl, {
      method: 'HEAD',
    });

    if (!response.ok) {
      return {
        valid: false,
        error: `Key file not found at ${keyUrl}`,
      };
    }

    return { valid: true };
  } catch (error: any) {
    return {
      valid: false,
      error: error.message || 'Failed to validate IndexNow setup',
    };
  }
};

