------------------------ MODULE SongConfiguration -------------------------
EXTENDS Naturals, FiniteSets, TLC
CONSTANTS Attempts, Configurations, Mutation
VARIABLES current, phase, started, owner, pending, used, commits,
          closing, closed, badCommit, badRevision
vars == <<current, phase, started, owner, pending, used, commits,
          closing, closed, badCommit, badRevision>>
Init == /\ current = 0 /\ phase = "off" /\ started = {}
        /\ owner = 0 /\ pending = {} /\ used = {} /\ commits = 0
        /\ closing = FALSE /\ closed = FALSE
        /\ badCommit = FALSE /\ badRevision = FALSE
Enable(a) == /\ ~closing /\ current = 0 /\ phase \in {"off", "fault"}
             /\ a \notin started
             /\ (owner = 0 \/ Mutation = "enable-during-config")
             /\ current' = a /\ phase' = "starting" /\ started' = started \cup {a}
             /\ UNCHANGED <<owner, pending, used, commits, closing, closed, badCommit, badRevision>>
NativeReady == /\ current # 0 /\ phase = "starting"
               /\ phase' = "ready"
               /\ UNCHANGED <<current, started, owner, pending, used, commits, closing, closed, badCommit, badRevision>>
Terminate == /\ current # 0 /\ phase \in {"starting", "ready"}
             /\ phase' = "stopping"
             /\ UNCHANGED <<current, started, owner, pending, used, commits, closing, closed, badCommit, badRevision>>
ConfirmExit == /\ current # 0 /\ phase = "stopping"
               /\ current' = 0 /\ phase' = "off"
               /\ UNCHANGED <<started, owner, pending, used, commits, closing, closed, badCommit, badRevision>>
ConfirmedFailure == /\ current # 0 /\ phase \in {"starting", "ready"}
                    /\ current' = 0 /\ phase' = "fault"
                    /\ UNCHANGED <<started, owner, pending, used, commits, closing, closed, badCommit, badRevision>>
ClearFault == /\ current = 0 /\ phase = "fault"
              /\ phase' = "off"
              /\ UNCHANGED <<current, started, owner, pending, used, commits, closing, closed, badCommit, badRevision>>
BeginConfigure(c, isCurrent) ==
  /\ (~closing \/ Mutation = "config-after-close") /\ c \notin used
  /\ (current = 0 \/ Mutation = "config-during-audio")
  /\ (phase = "off" \/ Mutation \in {"config-during-audio", "config-during-fault"})
  /\ (owner = 0 \/ Mutation = "overlapping-config")
  /\ (isCurrent \/ Mutation = "stale-revision")
  /\ owner' = c /\ pending' = pending \cup {c} /\ used' = used \cup {c}
  /\ badRevision' = (badRevision \/ ~isCurrent)
  /\ UNCHANGED <<current, phase, started, commits, closing, closed, badCommit>>
FinishConfigure(c, success) ==
  /\ c \in pending
  /\ LET commit == success /\ (~closing \/ Mutation = "commit-after-close")
     IN /\ commits' = IF commit THEN commits + 1 ELSE commits
        /\ badCommit' = (badCommit \/ (commit /\ closing))
  /\ pending' = pending \ {c} /\ owner' = 0
  /\ UNCHANGED <<current, phase, started, used, closing, closed, badRevision>>
BeginClose ==
  /\ ~closing
  /\ closing' = TRUE
  /\ closed' = (current = 0 /\ (pending = {} \/ Mutation = "close-without-wait"))
  /\ phase' = IF current # 0 THEN "stopping" ELSE phase
  /\ UNCHANGED <<current, started, owner, pending, used, commits, badCommit, badRevision>>
ConfirmClosed == /\ closing /\ current = 0 /\ pending = {}
                 /\ closed' = TRUE
                 /\ UNCHANGED <<current, phase, started, owner, pending, used, commits, closing, badCommit, badRevision>>
Next == (\E a \in Attempts : Enable(a)) \/ NativeReady \/ Terminate \/ ConfirmExit \/
        ConfirmedFailure \/ ClearFault \/
        (\E c \in Configurations, isCurrent \in BOOLEAN : BeginConfigure(c, isCurrent)) \/
        (\E c \in Configurations, success \in BOOLEAN : FinishConfigure(c, success)) \/
        BeginClose \/ ConfirmClosed
TypeOK == /\ current \in Attempts \cup {0} /\ started \subseteq Attempts
          /\ phase \in {"off", "starting", "ready", "stopping", "fault"}
          /\ owner \in Configurations \cup {0} /\ pending \subseteq used /\ used \subseteq Configurations
          /\ (owner = 0 \/ owner \in pending)
          /\ commits \in 0..Cardinality(Configurations)
          /\ closing \in BOOLEAN /\ closed \in BOOLEAN /\ badCommit \in BOOLEAN /\ badRevision \in BOOLEAN
OneConfiguration == Cardinality(pending) <= 1
NoOwnedConfiguration == pending = {} \/ current = 0
ConfigurationRequiresOff == pending = {} \/ phase = "off"
NoCommitAfterClosing == ~badCommit
ClosedHasNoConfiguration == closed => pending = {}
NoStaleConfigurationRevision == ~badRevision
Spec == Init /\ [][Next]_vars
=============================================================================
