---------------------------- MODULE NativeAudio ----------------------------
EXTENDS Naturals, FiniteSets, TLC
CONSTANTS Attempts, Mutation
VARIABLES current, phase, viewAttempt, started, spawned, alive, terminated,
          aborted, stage, finish, commandTarget, commandResult, appliedOn,
          badEvent, subscribed, commandValid, assigned, requested
vars == <<current, phase, viewAttempt, started, spawned, alive, terminated,
          aborted, stage, finish, commandTarget, commandResult, appliedOn,
          badEvent, subscribed, commandValid, assigned, requested>>
Init == /\ current = 0 /\ phase = "off" /\ viewAttempt = 0
        /\ started = {} /\ spawned = {} /\ alive = {}
        /\ terminated = {} /\ aborted = {}
        /\ stage = [a \in Attempts |-> "unused"]
        /\ finish = [a \in Attempts |-> "fault"]
        /\ commandTarget = 0 /\ commandResult = "none" /\ appliedOn = 0
        /\ badEvent = FALSE /\ subscribed = {} /\ commandValid = TRUE /\ assigned = {} /\ requested = {}
Enable(a) == /\ current = 0 /\ a \notin started
             /\ current' = a /\ phase' = "starting" /\ viewAttempt' = a
             /\ started' = started \cup {a}
             /\ stage' = [stage EXCEPT ![a] = "reserved"]
             /\ UNCHANGED <<spawned, alive, terminated, aborted, finish,
                            commandTarget, commandResult, appliedOn, badEvent, subscribed, commandValid, assigned, requested>>
SetupFailed(a) == /\ current = a /\ stage[a] = "reserved"
                  /\ stage' = [stage EXCEPT ![a] = "checking"]
                  /\ UNCHANGED <<current, phase, viewAttempt, started, spawned, alive,
                                 terminated, aborted, finish, commandTarget,
                                 commandResult, appliedOn, badEvent, subscribed, commandValid, assigned, requested>>
BeginSpawn(a) == /\ current = a /\ stage[a] = "reserved" /\ a \notin aborted
                 /\ stage' = [stage EXCEPT ![a] = "acquiring"]
                 /\ requested' = requested \cup {a}
                 /\ UNCHANGED <<current, phase, viewAttempt, started, spawned, alive,
                                terminated, aborted, finish, commandTarget,
                                commandResult, appliedOn, badEvent, subscribed, commandValid, assigned>>
ChildAcquired(a) == /\ current = a /\ stage[a] = "acquiring"
                    /\ stage' = [stage EXCEPT ![a] = "acquired"]
                    /\ spawned' = spawned \cup {a} /\ alive' = alive \cup {a}
                    /\ UNCHANGED <<current, phase, viewAttempt, started, terminated,
                                   aborted, finish, commandTarget, commandResult,
                                   appliedOn, badEvent, subscribed, commandValid, assigned, requested>>
Spawn(a) == /\ current = a /\ stage[a] = "acquired" /\ a \notin aborted
            /\ stage' = [stage EXCEPT ![a] = "preparing"]
            /\ assigned' = assigned \cup {a}
            /\ UNCHANGED <<current, phase, viewAttempt, started, spawned, alive,
                           terminated, aborted, finish, commandTarget,
                           commandResult, appliedOn, badEvent, subscribed, commandValid, requested>>
SpawnFailed(a) == /\ current = a /\ stage[a] \in {"acquiring", "acquired"}
                  /\ stage' = [stage EXCEPT ![a] = "checking"]
                  /\ UNCHANGED <<current, phase, viewAttempt, started, spawned, alive,
                                 terminated, aborted, finish, commandTarget,
                                 commandResult, appliedOn, badEvent, subscribed, commandValid, assigned, requested>>
PrepareDone(a) == /\ current = a /\ stage[a] = "preparing" /\ a \notin aborted
                  /\ stage' = [stage EXCEPT ![a] = "readback"]
                  /\ UNCHANGED <<current, phase, viewAttempt, started, spawned,
                                 alive, terminated, aborted, finish, commandTarget,
                                 commandResult, appliedOn, badEvent, subscribed, commandValid, assigned, requested>>
PublishReady(a) == /\ current = a /\ stage[a] = "readback" /\ a \notin aborted
                   /\ stage' = [stage EXCEPT ![a] = "ready"]
                   /\ phase' = "ready" /\ viewAttempt' = IF Mutation = "identity" THEN 0 ELSE a
                   /\ subscribed' = subscribed \cup {a}
                   /\ UNCHANGED <<current, started, spawned, alive, terminated,
                                  aborted, finish, commandTarget, commandResult,
                                  appliedOn, badEvent, commandValid, assigned, requested>>
Terminate == /\ current # 0 /\ phase \in {"starting", "ready", "stopping"}
             /\ terminated' = terminated \cup {current}
             /\ aborted' = IF Mutation = "cancel" THEN aborted ELSE aborted \cup {current}
             /\ finish' = [finish EXCEPT ![current] = "off"]
             /\ phase' = "stopping"
             /\ UNCHANGED <<current, viewAttempt, started, spawned, alive,
                            stage, commandTarget, commandResult, appliedOn, badEvent, subscribed, commandValid, assigned, requested>>
NativeExit(a) == /\ a \in alive
                 /\ alive' = alive \ {a}
                 /\ UNCHANGED <<current, phase, viewAttempt, started, spawned,
                                terminated, aborted, stage, finish, commandTarget,
                                commandResult, appliedOn, badEvent, subscribed, commandValid, assigned, requested>>
BeginCleanup(a) == /\ current = a /\ (a \in aborted \/ (a \in spawned /\ a \notin alive))
                   /\ stage[a] \in {"reserved", "acquired", "preparing", "readback", "ready"}
                   /\ stage' = [stage EXCEPT ![a] = "checking"]
                   /\ UNCHANGED <<current, phase, viewAttempt, started, spawned,
                                  alive, terminated, aborted, finish, commandTarget,
                                  commandResult, appliedOn, badEvent, subscribed, commandValid, assigned, requested>>
FinishExited(a) == /\ current = a /\ stage[a] = "checking"
                   /\ (a \notin requested \/ a \in assigned \/ Mutation = "ownership")
                   /\ (a \notin alive \/ (Mutation = "cleanup" /\ a \in assigned) \/
                       (Mutation = "ownership" /\ a \in requested \ assigned))
                   /\ current' = 0 /\ phase' = finish[a] /\ viewAttempt' = 0
                   /\ stage' = [stage EXCEPT ![a] = "done"]
                   /\ UNCHANGED <<started, spawned, alive, terminated, aborted,
                                  finish, commandTarget, commandResult, appliedOn, badEvent, subscribed, commandValid, assigned, requested>>
HoldPending(a) == /\ current = a /\ stage[a] = "checking"
                  /\ a \in requested \ assigned
                  /\ stage' = [stage EXCEPT ![a] = "blocked"] /\ phase' = "stopping"
                  /\ UNCHANGED <<current, viewAttempt, started, spawned, alive,
                                 terminated, aborted, finish, commandTarget,
                                 commandResult, appliedOn, badEvent, subscribed, commandValid, assigned, requested>>
CleanupUnconfirmed(a) == /\ current = a /\ stage[a] = "checking" /\ a \in assigned
                         /\ stage' = [stage EXCEPT ![a] = "blocked"]
                         /\ phase' = "stopping"
                         /\ UNCHANGED <<current, viewAttempt, started, spawned,
                                        alive, terminated, aborted, finish, commandTarget,
                                        commandResult, appliedOn, badEvent, subscribed, commandValid, assigned, requested>>
IssueCommand == /\ phase = "ready" /\ current \notin aborted
                /\ commandResult = "none" /\ commandTarget = 0
                /\ commandTarget' = current /\ commandResult' = "pending"
                /\ UNCHANGED <<current, phase, viewAttempt, started, spawned,
                               alive, terminated, aborted, stage, finish, appliedOn, badEvent, subscribed, commandValid, assigned, requested>>
ReturnCommand == /\ commandResult = "pending"
                 /\ LET valid == current = commandTarget /\ phase = "ready" /\ current \notin aborted
                    IN /\ commandResult' = IF valid \/ Mutation = "command" THEN "applied" ELSE "unknown"
                       /\ appliedOn' = IF valid \/ Mutation = "command" THEN current ELSE 0
                       /\ commandValid' = valid
                 /\ UNCHANGED <<current, phase, viewAttempt, started, spawned,
                                alive, terminated, aborted, stage, finish, commandTarget, badEvent, subscribed, assigned, requested>>
DeliverEvent(a) == /\ a \in subscribed
                   /\ LET valid == current = a /\ phase = "ready" /\ a \notin aborted
                      IN badEvent' = (badEvent \/ (Mutation = "observe" /\ ~valid))
                   /\ UNCHANGED <<current, phase, viewAttempt, started, spawned,
                                  alive, terminated, aborted, stage, finish,
                                  commandTarget, commandResult, appliedOn, subscribed, commandValid, assigned, requested>>
Next == (\E a \in Attempts : Enable(a) \/ SetupFailed(a) \/ BeginSpawn(a) \/ ChildAcquired(a) \/ Spawn(a) \/ SpawnFailed(a) \/ PrepareDone(a) \/
          PublishReady(a) \/ NativeExit(a) \/ BeginCleanup(a) \/
          FinishExited(a) \/ HoldPending(a) \/ CleanupUnconfirmed(a) \/ DeliverEvent(a)) \/
        Terminate \/ IssueCommand \/ ReturnCommand
TypeOK == /\ current \in Attempts \cup {0}
          /\ phase \in {"off", "starting", "ready", "stopping", "fault"}
          /\ alive \subseteq spawned /\ spawned \subseteq started /\ assigned \subseteq spawned /\ spawned \subseteq requested /\ requested \subseteq started
          /\ terminated \subseteq started /\ aborted \subseteq started /\ subscribed \subseteq started
          /\ stage \in [Attempts -> {"unused", "reserved", "acquiring", "acquired", "preparing", "readback", "ready", "checking", "blocked", "done"}]
          /\ finish \in [Attempts -> {"off", "fault"}]
NoCanceledReady == phase = "ready" => current \notin terminated
ReadyIdentity == phase = "ready" => current # 0 /\ viewAttempt = current
OneOwnedChild == Cardinality(alive) <= 1 /\ (current = 0 => alive = {})
NoStaleApplied == commandResult = "applied" => commandValid /\ appliedOn = commandTarget /\ appliedOn # 0
UnknownOwnershipHeld == \A a \in requested \ assigned : stage[a] # "done"
NoStaleEvent == ~badEvent
Spec == Init /\ [][Next]_vars
=============================================================================
