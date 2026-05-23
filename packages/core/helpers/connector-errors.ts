export class MissingConnectorConfigError extends Error {
  constructor(name: string, variable: string) {
    super(`${name} is not configured. Set ${variable}.`);
    this.name = "MissingConnectorConfigError";
  }
}

export class ConnectorRequestError extends Error {
  constructor(
    name: string,
    public readonly status: number,
    message: string,
  ) {
    super(`${name} request failed with ${status}: ${message}`);
    this.name = "ConnectorRequestError";
  }
}

export async function readJsonResponse<T>(name: string, response: Response): Promise<T> {
  const text = await response.text();

  if (!response.ok) {
    throw new ConnectorRequestError(name, response.status, text);
  }

  return JSON.parse(text) as T;
}
