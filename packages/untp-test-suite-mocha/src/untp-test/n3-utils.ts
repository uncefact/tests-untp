import jsonld from 'jsonld';
import n3 from 'n3';

/**
 * Creates an RDF graph from pre-parsed JSON-LD data and stores quads in the provided N3 Store.
 * @param jsonData - parsed JSON-LD data
 * @param filePath - file path
 * @param n3store - The N3 Store to add quads to.
 * @param useNamedGraphs - Whether to store quads in named graphs (defaults to false)
 * @returns Promise with the RDF store and any validation results
 */
export async function storeQuads(
  jsonData: any,
  filePath: string,
  n3store: n3.Store,
  useNamedGraphs = false,
) {
  const graphName = n3.DataFactory.namedNode(`file://${filePath}` || jsonData.id || 'urn:unnamed');

  // Convert JSON-LD to N-Quads string jsonld.js
  const quadString = await jsonld.toRDF(jsonData, {
    format: 'application/n-quads',
  });

  const n3parser = new n3.Parser({ format: 'N-Quads' });
  let quads: n3.Quad[] = n3parser.parse(quadString.toString());

  if (useNamedGraphs) {
    quads = quads.map((q) => n3.DataFactory.quad(q.subject, q.predicate, q.object, graphName));
  }

  n3store.addQuads(quads);
}


/**
 * Converts parsed JSON-LD data to N-Quads
 * @param jsonData - The parsed JSON-LD data
 * @param fileName - Optional file name to be used as base URI for the data
 * @param useNamedGraphs - Whether to store quads in named graphs (defaults to false)
 * @returns Promise with the parsed quads
 */
export async function getQuads(
  jsonData: any,
  fileName?: string,
  useNamedGraphs = false,
): Promise<n3.Quad[]> {
  const graphName = n3.DataFactory.namedNode(fileName || jsonData.id || 'urn:unnamed');

  // Convert JSON-LD to N-Quads string jsonld.js
  const quadString = await jsonld.toRDF(jsonData, {
    format: 'application/n-quads',
  });

  const n3parser = new n3.Parser({ format: 'N-Quads' });
  const quads = n3parser.parse(quadString.toString());

  // If using named graphs, set each quad's fourth element to the graph name
  if (useNamedGraphs) {
    return quads.map((q) => n3.DataFactory.quad(q.subject, q.predicate, q.object, graphName));
  }

  return quads;
}


/**
 * Runs all inference rules in the inferences directory in numerical order
 * Works in both Node.js and browser environments
 * @param n3store - The N3 Store to run inferences on (will be updated in place)
 * @returns Promise with boolean indicating success or failure
 */
export async function runInferences(n3store: n3.Store): Promise<boolean> {
  try {
    let inferenceFiles: Record<string, string> = {};

    // Check if we're in a browser environment
    if (typeof window !== 'undefined') {
      // Browser environment - use pre-bundled inference files
      try {
        const { INFERENCE_FILES } = await import('../generated/inference-bundle');
        inferenceFiles = INFERENCE_FILES;
      } catch (error) {
        console.error('Failed to load inference bundle:', error);
        return false;
      }
    } else {
      // Node.js environment - read files from filesystem
      try {
        const fs = require('fs');
        const path = require('path');

        const inferencesDir = path.join(__dirname, '../../src/inferences');
        const files = fs.readdirSync(inferencesDir)
          .filter((file: string) => file.endsWith('.n3'))
          .sort();

        for (const file of files) {
          const filePath = path.join(inferencesDir, file);
          const content = fs.readFileSync(filePath, 'utf8');
          inferenceFiles[file] = content;
        }
      } catch (error) {
        console.error('Failed to read inference files:', error);
        return false;
      }
    }

    // Process inference files in sorted order
    const sortedFiles = Object.keys(inferenceFiles).sort();
    console.log(`Running ${sortedFiles.length} inference rules...`);

    for (const fileName of sortedFiles) {
      const n3rules = inferenceFiles[fileName];
      console.log(`Executing inference rule: ${fileName}`);

      try {
        // Get full credentials RDF graph as quads
        const credentialQuads = n3store.getQuads(null, null, null, null);

        // Execute the inference rules
        const inferencedQuads = await execRules(n3rules, credentialQuads);

        // Add the inferenced quads to the n3store
        n3store.addQuads(inferencedQuads);

      } catch (error) {
        console.warn(`Error executing inference rule ${fileName}:`, error);
      }
    }

    return true;
  } catch (error) {
    console.error(`Error running inferences: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}


/**
 * Executes given N3 entailment rules against the credentials RDF graph using EYE reasoner
 * @param n3rules - The n3 inferencing rules as sting
 * @param credentials - Credentilas graph as an array of quads
 * @returns Promise with the query results as quads
 */
async function execRules(
  n3rules: string,
  credentials: n3.Quad[],
): Promise<n3.Quad[]> {
  // Serialize credential quads to string
  const writer = new n3.Writer({ format: 'N3' });
  writer.addQuads(credentials);
  const graphContent = await new Promise<string>((resolve, reject) => {
    writer.end((error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });

  let eyereasoner: any;
  
  if (typeof window === 'undefined') {
    eyereasoner = require('eyereasoner');
  }
  else {
    eyereasoner = (window as any).eyereasoner;
  }

  // Check if eyereasoner is available
  if (!eyereasoner) {
    throw new Error('EYE reasoner not available in this environment');
  }

  // We specify string for outputType so that we can both run the query
  // on the eyereasoner CLI manually with the --strings option, while also
  // run it here via the API and filter out the log:outputString triplets,
  // enabling the same query file to be used in both cases, as a pattern
  // for developing future queries.
  const eyeOptions: any = {
    outputType: "string"
  };

  try {

    // Execute the query using n3reasoner
    const result = await eyereasoner.n3reasoner(graphContent, n3rules, eyeOptions);

    // If result is already an array of quads, return it
    if (Array.isArray(result) && result.length > 0 && result[0].subject) {
      return result;
    }

    // If we got a string instead (fallback case), filter out log:outputString statements and parse
    if (typeof result === 'string') {
      // Filter out lines containing log:outputString
      // This regex matches lines that contain log:outputString as a predicate
      const outputStringRegex = /^.*\\\\s+log:outputString\\\\s+.*\\\\.$/gm;
      const filteredResult = result.replace(outputStringRegex, '');

      try {
        const n3parser = new n3.Parser();
        const parsedQuads = n3parser.parse(filteredResult);
        return parsedQuads;
      } catch (parseError) {
        console.error(`Error parsing filtered result:`, parseError);

        // If parsing still fails, try a more aggressive approach
        // Extract only lines that look like valid RDF triples (starting with '<')
        const tripleLines = filteredResult.split('\n')
          .filter(line => {
            const trimmed = line.trim();
            return trimmed.startsWith('<') && trimmed.includes('>') && !trimmed.includes('log:outputString');
          });

        if (tripleLines.length > 0) {
          const triplesOnly = tripleLines.join('\n');

          try {
            const n3parser = new n3.Parser();
            const parsedQuads = n3parser.parse(triplesOnly);
            return parsedQuads;
          } catch (extractError) {
            console.error(`Error parsing extracted triples:`, extractError);
          }
        }

        console.warn(`Could not parse result into valid quads, returning empty array`);
        return [];
      }
    }

    // If we got something else, return empty array
    console.warn(`Unexpected result type: ${typeof result}`);
    return [];
  } catch (error) {
    console.error(`Error details for query ${n3rules}:`, error);
    throw new Error(`Error executing EYE reasoner: ${error instanceof Error ? error.message : String(error)}`);
  }
}


/**
 * Initializes and returns a new N3 Store instance.
 * @returns A new n3.Store instance.
 */
export function createN3Store(): n3.Store {
  return new n3.Store();
}