#!/usr/bin/env python3
"""double-fork daemonizer — replicate the agent-browser daemon's survival
pattern (ppid 1, detached session, reparented WITHIN the spawning call).
Usage: daemonize.py <logfile> <cmd> [args...]"""
import os, sys

LOG = open(sys.argv[1], "ab", 0)
cmd = sys.argv[2:]

# first fork: exit parent immediately, child continues
pid = os.fork()
if pid > 0:
    os.waitpid(pid, 0)  # reap the intermediate so the grandchild reparents to init
    sys.exit(0)

# child: new session, become leader
os.setsid()

# second fork: session leader exits, grandchild is NOT a leader — cannot
# reacquire a controlling terminal; reparents to init when we exit
pid2 = os.fork()
if pid2 > 0:
    os._exit(0)

# grandchild: detach stdio, run
os.dup2(LOG.fileno(), 0)
os.dup2(LOG.fileno(), 1)
os.dup2(LOG.fileno(), 2)
os.chdir("/home/z/my-project")
os.execvp(cmd[0], cmd)
