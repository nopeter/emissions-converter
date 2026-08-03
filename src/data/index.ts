/**
 * The single typed entry point to the parameter library.
 *
 * Engine code imports `parameters` from here rather than importing the JSON
 * directly, so that there is exactly one place where the raw file is asserted
 * to match the declared types.
 */
import raw from './parameters.json';
import type { ParameterLibrary } from './types';

export const parameters = raw as unknown as ParameterLibrary;

export * from './types';
