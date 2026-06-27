
import asyncio
import json
import logging
import os
import subprocess
import sys
from typing import Dict, Any

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
log = logging.getLogger("HermesHTTPBridge")

HERMES_MCP_URL = os.getenv("HERMES_MCP_URL", "http://127.0.0.1:9090") # Default URL for VibeServe's Hermes integration
HERMES_COMMAND = ["hermes", "mcp", "serve"] # Command to run Hermes MCP server in stdio mode
HERMES_TIMEOUT_SEC = 5 # Timeout for subprocess communication

# Default port for the bridge server
BRIDGE_PORT = int(os.getenv("BRIDGE_PORT", "9090"))
BRIDGE_HOST = os.getenv("BRIDGE_HOST", "127.0.0.1")

class HermesSubprocess:
    def __init__(self, command: list[str]):
        self.command = command
        self.process: subprocess.Popen | None = None
        self.stdin: asyncio.StreamWriter | None = None
        self.stdout: asyncio.StreamReader | None = None
        self.stderr: asyncio.StreamReader | None = None
        self.process_task: asyncio.Task | None = None
        self.running = False

    async def start(self):
        try:
            log.info(f"Starting Hermes subprocess: {' '.join(self.command)}")
            self.process = await asyncio.create_subprocess_exec(
                *self.command,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                limit=2**16 # 64KB buffer for stdout/stderr
            )
            self.stdin = asyncio.StreamWriter(self.process.stdin, protocol=asyncio.SubprocessProtocol(), reader=None, loop=asyncio.get_running_loop())
            self.stdout = asyncio.StreamReader(loop=asyncio.get_running_loop())
            self.stderr = asyncio.StreamReader(loop=asyncio.get_running_loop())

            # Pipe stdout and stderr from subprocess to StreamReader
            asyncio.create_task(self._pipe_stream(self.process.stdout, self.stdout.feed_data))
            asyncio.create_task(self._pipe_stream(self.process.stderr, self.stderr.feed_data))

            self.running = True
            log.info("Hermes subprocess started successfully.")
        except FileNotFoundError:
            log.error(f"Hermes command not found. Is Hermes installed and in your PATH?")
            self.running = False
            raise
        except Exception as e:
            log.error(f"Error starting Hermes subprocess: {e}")
            self.running = False
            raise

    async def _pipe_stream(self, stream, feed_method):
        """Helper to pipe stream data to a feed method."""
        if not stream:
            return
        try:
            while True:
                data = await stream.read(1024)
                if not data:
                    break
                feed_method(data)
        except Exception as e:
            log.error(f"Error piping stream: {e}")
        finally:
            # Signal EOF to the StreamReader
            if hasattr(self.stdout, 'feed_eof'):
                self.stdout.feed_eof()
            if hasattr(self.stderr, 'feed_eof'):
                self.stderr.feed_eof()


    async def send_request(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        if not self.running or not self.stdin or not self.stdout:
            return {"error": "Hermes subprocess not running"}

        try:
            # Add trace_id if not present, though VibeServe tool should handle this
            if "id" not in payload:
                payload["id"] = str(asyncio.get_running_loop().time()) # Simple ID for now

            # Hermes expects JSON-RPC payload
            message = json.dumps(payload) + "\n"
            self.stdin.write(message.encode())
            await self.stdin.drain()

            # Read response from Hermes stdout. Hermes usually sends one JSON response per request.
            # We'll read until a newline, assuming the response is newline-delimited.
            # A more robust solution might involve framing or specific delimiters.
            # For simplicity, we read a chunk and try to parse.
            # Hermes might also send logs to stdout, so we need to be careful.
            
            # Reading a full line from stdout. This might block if Hermes doesn't send a newline promptly.
            # A better approach might be to use a JSON stream parser.
            # For now, let's read up to a certain limit and try to parse.
            
            # Read up to a reasonable buffer size for a single JSON response.
            # If Hermes sends logs interleaved with JSON, this can be tricky.
            # A common pattern for subprocesses is to have separate channels or framing.
            # Let's assume for now Hermes sends one JSON line per response.

            response_data = await self.stdout.readline()
            if not response_data:
                return {"error": "Hermes subprocess closed stdout unexpectedly"}

            response = json.loads(response_data.decode())
            return response

        except json.JSONDecodeError:
            log.error(f"Failed to decode JSON response from Hermes: {response_data.decode()}")
            return {"error": "Failed to decode JSON response from Hermes"}
        except Exception as e:
            log.error(f"Error communicating with Hermes subprocess: {e}")
            return {"error": str(e)}

    async def stop(self):
        if self.process and self.process.returncode is None:
            log.info("Stopping Hermes subprocess...")
            try:
                # Attempt graceful shutdown first
                if self.stdin:
                    self.stdin.close()
                if self.process.terminate():
                    await asyncio.wait_for(self.process.wait(), timeout=HERMES_TIMEOUT_SEC)
                else:
                    log.warning("Hermes process did not respond to terminate, killing...")
                    self.process.kill()
                    await asyncio.wait_for(self.process.wait(), timeout=HERMES_TIMEOUT_SEC)
            except asyncio.TimeoutError:
                log.warning("Hermes subprocess did not terminate in time, killing...")
                self.process.kill()
            except Exception as e:
                log.error(f"Error stopping Hermes subprocess: {e}")
            finally:
                self.running = False
                log.info("Hermes subprocess stopped.")
        else:
            log.info("Hermes subprocess is not running or already stopped.")


async def handle_request(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    """Handle incoming HTTP requests and forward them to Hermes subprocess."""
    request_line_bytes = await reader.readline()
    if not request_line_bytes:
        writer.close()
        await writer.wait_closed()
        return

    request_line = request_line_bytes.decode('utf-8').strip()
    method, path, _ = request_line.split()

    headers: Dict[str, str] = {}
    while True:
        line_bytes = await reader.readline()
        if not line_bytes or line_bytes == b'\r\n':
            break
        line = line_bytes.decode('utf-8').strip()
        if ':' in line:
            k, v = line.split(':', 1)
            headers[k.strip()] = v.strip()

    content_length = int(headers.get('content-length', 0))
    transfer_encoding = headers.get('transfer-encoding', '')
    log.debug(f"Request headers: {headers}")
    log.debug(f"Content-Length: {content_length}, Transfer-Encoding: {transfer_encoding}")
    
    request_body_bytes = b''
    if 'chunked' in transfer_encoding.lower():
        # Handle chunked transfer encoding
        while True:
            line = await reader.readline()
            if not line:
                break
            chunk_size = int(line.decode('utf-8').strip(), 16)
            if chunk_size == 0:
                # Read the final CRLF
                await reader.readline()
                break
            chunk = await reader.readexactly(chunk_size)
            request_body_bytes += chunk
            # Read the CRLF after chunk
            await reader.readline()
    elif content_length:
        request_body_bytes = await reader.read(content_length)
    
    response_status = 200
    response_body_json: Dict[str, Any] = {}
    response_headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*", # Allow all origins for simplicity, adjust as needed
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-VibeServe-API-Key",
    }

    if method == "OPTIONS":
        writer.write(b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n")
        await writer.drain()
        return
    
    if method == "GET" and path == "/health":
        response_body_json = {"status": "ok", "service": "HermesHTTPBridge"}
        if hermes_subprocess.running:
            response_body_json["hermes_status"] = "running"
        else:
            response_body_json["hermes_status"] = "stopped"
            response_status = 503 # Service Unavailable
    elif method == "POST" and path == "/mcp":
        try:
            log.debug(f"Request body bytes: {request_body_bytes!r}")
            log.debug(f"Request body string: {request_body_bytes.decode('utf-8', errors='replace') if request_body_bytes else 'empty'}")
            try:
                payload = json.loads(request_body_bytes.decode('utf-8'))
            except json.JSONDecodeError as e:
                log.error(f"JSON decode error: {e}")
                log.error(f"Body bytes repr: {request_body_bytes!r}")
                # Echo back the raw bytes for debugging
                response_status = 400
                response_body_json = {"error": f"Invalid JSON payload: {str(e)}", "received": request_body_bytes.decode('utf-8', errors='replace')}
                response_body = json.dumps(response_body_json).encode('utf-8')
                response_headers_str = "\r\n".join(f"{k}: {v}" for k, v in response_headers.items())
                response_line = (
                    f"HTTP/1.1 {response_status} {get_reason_phrase(response_status)}\r\n"
                    f"{response_headers_str}\r\n"
                    f"Content-Length: {len(response_body)}\r\n"
                    f"\r\n"
                )
                writer.write(response_line.encode('utf-8') + response_body)
                await writer.drain()
                return
            
            # Extract VibeServe's tool name and forward to Hermes
            # VibeServe sends tool name in path, e.g. /mcp/vs_hermes_memory_query
            # Hermes expects method in payload, e.g. {"method": "memory.search", ...}
            if "method" not in payload: # If method is not in payload, try to infer from path
                if path.startswith("/mcp/"):
                    # Infer Hermes method from VibeServe tool name
                    # e.g. vs_hermes_memory_query -> memory.search
                    tool_name = path[len("/mcp/"):].strip("/")
                    if tool_name.startswith("vs_hermes_"):
                        hermes_method = tool_name[len("vs_hermes_"):].replace("_", ".")
                        payload["method"] = hermes_method
                    else:
                        log.warning(f"Could not infer Hermes method from VibeServe tool name: {tool_name}")
                        response_status = 400
                        response_body_json = {"error": f"Could not infer Hermes method from VibeServe tool name: {tool_name}"}

            if response_status == 200: # If no error in inference
                hermes_response = await hermes_subprocess.send_request(payload)
                response_body_json = hermes_response
                if hermes_response.get("error"):
                    response_status = 500 # Internal Server Error for Hermes errors
                elif hermes_response.get("status") == "unavailable":
                    response_status = 503 # Service Unavailable if Hermes is down
                else:
                    response_status = 200 # OK for Hermes success
        except json.JSONDecodeError:
            response_status = 400
            response_body_json = {"error": "Invalid JSON payload"}
        except Exception as e:
            log.exception("Error processing POST request to /mcp")
            response_status = 500
            response_body_json = {"error": f"Internal server error: {str(e)}"}
    else:
        response_status = 404
        response_body_json = {"error": "Not Found"}

    response_body = json.dumps(response_body_json).encode('utf-8')

    response_headers_str = "\r\n".join(f"{k}: {v}" for k, v in response_headers.items())
    response_line = (
        f"HTTP/1.1 {response_status} {get_reason_phrase(response_status)}\r\n"
        f"{response_headers_str}\r\n"
        f"Content-Length: {len(response_body)}\r\n"
        f"\r\n"
    )
    
    writer.write(response_line.encode('utf-8') + response_body)
    await writer.drain()
    writer.close()
    await writer.wait_closed()


def get_reason_phrase(status_code: int) -> str:
    """Returns the HTTP reason phrase for a given status code."""
    reasons = {
        200: "OK", 204: "No Content",
        400: "Bad Request", 401: "Unauthorized", 404: "Not Found", 413: "Payload Too Large",
        500: "Internal Server Error", 503: "Service Unavailable"
    }
    return reasons.get(status_code, "Unknown Status")


async def start_bridge_server():
    """Start the HTTP bridge server."""
    global hermes_subprocess
    hermes_subprocess = HermesSubprocess(HERMES_COMMAND)
    try:
        await hermes_subprocess.start()
        log.info(f"Starting HTTP bridge server on {BRIDGE_HOST}:{BRIDGE_PORT}")
        server = await asyncio.start_server(handle_request, BRIDGE_HOST, BRIDGE_PORT)
        async with server:
            await server.serve_forever()
    except Exception as e:
        log.error(f"Failed to start HTTP bridge server: {e}")
    finally:
        await hermes_subprocess.stop()

def run_bridge():
    """Run the HTTP bridge server in a blocking manner."""
    try:
        asyncio.run(start_bridge_server())
    except KeyboardInterrupt:
        log.info("HTTP bridge server stopped by user.")
    finally:
        # Ensure Hermes subprocess is stopped on exit
        if hermes_subprocess and hermes_subprocess.running:
            asyncio.run(hermes_subprocess.stop())

if __name__ == "__main__":
    # Set default HERMES_MCP_URL if not provided and VibeServe uses it
    # This is mainly for the bridge to know where VibeServe expects Hermes to be.
    # The actual communication is via subprocess stdin/stdout.
    os.environ.setdefault("HERMES_MCP_URL", "http://127.0.0.1:9090")

    # Check if VibeServe expects Hermes to be available via HTTP
    # (This is inferred from HERMES_MCP_URL being set to an HTTP URL)
    if os.getenv("HERMES_MCP_URL", "").startswith("http"):
        log.info("VibeServe expects Hermes over HTTP. Starting bridge server.")
        run_bridge()
    else:
        log.warning("HERMES_MCP_URL is not set to an HTTP URL. Skipping bridge server startup.")
        sys.exit(1)
