
/**
 * Formats a JSON object to tree structure.
 * 
 * @param data the JSON to be formatted
 * @returns formatted JSON
 */
export const prettyJSON = (data: any) => {
    return JSON.stringify(data, null, 2)
}

/**
 * Logs a message to the console if the app is in development mode.
 * 
 * @param args the message to log
 */
export const logDebug = (...args: any[]) => {
    if (__DEV__) console.debug(...args);
  };
  