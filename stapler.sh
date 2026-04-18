#!/usr/bin/env bash
# Stapler control script
# Usage: ./stapler.sh start | stop | status | restart

STAPLER_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$STAPLER_DIR/.stapler.pid"
LOG_FILE="$STAPLER_DIR/.stapler.log"

ollama_start() {
  if pgrep -x ollama > /dev/null 2>&1; then
    echo "Ollama already running"
  else
    echo "Starting Ollama..."
    nohup ollama serve >> "$LOG_FILE" 2>&1 &
    sleep 2
    pgrep -x ollama > /dev/null && echo "Ollama started" || echo "Ollama failed to start"
  fi
}

ollama_stop() {
  if pgrep -x ollama > /dev/null 2>&1; then
    pkill -x ollama
    echo "Ollama stopped"
  else
    echo "Ollama not running"
  fi
}

start() {
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "Stapler already running (PID $(cat "$PID_FILE"))"
    return
  fi
  ollama_start
  echo "Starting Stapler..."
  # Use a subshell with `exec` so $! records the PID of the long-lived
  # `pnpm tsx` process itself, not a transient wrapper shell. Without this,
  # `stop` kills only the wrapper and leaves the server running.
  (cd "$STAPLER_DIR/server" && exec pnpm tsx src/index.ts >> "$LOG_FILE" 2>&1) &
  echo $! > "$PID_FILE"
  sleep 2
  if kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "Stapler started (PID $(cat "$PID_FILE")) — http://localhost:3100"
  else
    echo "Stapler failed to start. Check $LOG_FILE"
  fi
}

stop() {
  if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if kill -0 "$PID" 2>/dev/null; then
      kill "$PID"
      rm -f "$PID_FILE"
      echo "Stapler stopped (PID $PID)"
    else
      echo "Stapler not running (stale PID file removed)"
      rm -f "$PID_FILE"
    fi
  else
    pkill -f "tsx src/index.ts" 2>/dev/null && echo "Stapler stopped" || echo "Stapler not running"
  fi
  ollama_stop
}

status() {
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "Stapler RUNNING (PID $(cat "$PID_FILE")) — http://localhost:3100"
  else
    echo "Stapler STOPPED"
  fi
  pgrep -x ollama > /dev/null && echo "Ollama RUNNING" || echo "Ollama STOPPED"
}

case "$1" in
  start)   start ;;
  stop)    stop ;;
  restart) stop; sleep 1; start ;;
  status)  status ;;
  *)       echo "Usage: $0 start | stop | status | restart" ;;
esac
