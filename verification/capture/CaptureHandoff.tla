------------------------- MODULE CaptureHandoff -------------------------
EXTENDS Naturals, FiniteSets, TLC
CONSTANTS TakeCount, MaxCaptures, Mutation
Takes == 1..TakeCount
Banks == 1..2
Generations == 0..MaxCaptures
VARIABLES active, activeBank, activeLaunch, generation, latest, storage, playing, published, event
vars == <<active, activeBank, activeLaunch, generation, latest, storage, playing, published, event>>
EmptyEvent == [kind |-> "initial", take |-> 0, bank |-> 0, gen |-> 0, valid |-> FALSE, ready |-> FALSE, launch |-> "autoplay"]
Event(kind, valid, ready) == [kind |-> kind, take |-> active, bank |-> activeBank, gen |-> generation, valid |-> valid, ready |-> ready, launch |-> activeLaunch]
Initial == /\ active = 0 /\ activeBank = 0 /\ activeLaunch = "autoplay" /\ generation = 0
           /\ latest = [t \in Takes |-> 0]
           /\ storage = [t \in Takes |-> [b \in Banks |-> "empty"]]
           /\ playing = [t \in Takes |-> [b \in Banks |-> FALSE]]
           /\ published = [g \in Generations |-> 0] /\ event = EmptyEvent
Free(t) == {b \in Banks : b # latest[t] /\ ~playing[t][b]}
StartBanks(t) == IF Mutation = "overwriteLatest" /\ latest[t] # 0 /\ ~playing[t][latest[t]]
                THEN {latest[t]} ELSE Free(t)
LaunchPolicies == {"autoplay", "store-only"}
Begin(t, b, launch) == /\ active = 0 /\ generation < MaxCaptures /\ b \in StartBanks(t)
               /\ active' = t /\ activeBank' = b /\ activeLaunch' = launch /\ generation' = generation + 1
               /\ storage' = [storage EXCEPT ![t][b] = "capturing"]
               /\ event' = [EmptyEvent EXCEPT !.kind = "begin"]
               /\ UNCHANGED <<latest, playing, published>>
LatestAfterPublish == [latest EXCEPT ![active] = activeBank]
StorageAfterPublish == [storage EXCEPT ![active][activeBank] = "committed"]
PlayingAfterPublish == IF activeLaunch = "store-only" /\ Mutation # "storeAutoplays"
                       THEN playing
                       ELSE [playing EXCEPT ![active] = [b \in Banks |-> b = activeBank /\ Mutation # "noAutoplay"]]
PublishedAfterPublish == [published EXCEPT ![generation] = @ + 1]
Finish == /\ active # 0
          /\ latest' = LatestAfterPublish /\ storage' = StorageAfterPublish
          /\ playing' = PlayingAfterPublish /\ published' = PublishedAfterPublish
          /\ active' = 0 /\ activeBank' = 0
          /\ event' = Event("commit", TRUE, FALSE)
          /\ UNCHANGED <<generation, activeLaunch>>
Combined(t, b, ready, launch) ==
 /\ active # 0 /\ t # active
 /\ (ready => generation < MaxCaptures)
 /\ ready \in BOOLEAN /\ ((ready /\ b \in Free(t)) \/ (~ready /\ b = 0))
 /\ IF ready THEN
      /\ latest' = LatestAfterPublish
      /\ storage' = [StorageAfterPublish EXCEPT ![t][b] = "capturing"]
      /\ playing' = PlayingAfterPublish /\ published' = PublishedAfterPublish
      /\ active' = t /\ activeBank' = b /\ activeLaunch' = launch /\ generation' = generation + 1
    ELSE IF Mutation = "discardOnRejectedArm" THEN
      /\ storage' = [storage EXCEPT ![active][activeBank] = "empty"]
      /\ active' = 0 /\ activeBank' = 0
      /\ UNCHANGED <<generation, latest, playing, published, activeLaunch>>
    ELSE UNCHANGED <<active, activeBank, activeLaunch, generation, latest, storage, playing, published>>
 /\ event' = Event("combined", TRUE, ready)
Boundary(kind, t, b, valid, ready, launch) ==
 /\ active # 0 /\ t # active
 /\ ((ready /\ (valid \/ Mutation = "admitAfterInvalid")) => generation < MaxCaptures)
 /\ valid \in BOOLEAN /\ ready \in BOOLEAN /\ ((ready /\ b \in Free(t)) \/ (~ready /\ b = 0))
 /\ IF valid /\ ~(kind = "automatic" /\ Mutation = "missEndpoint") THEN
      /\ latest' = LatestAfterPublish /\ playing' = PlayingAfterPublish
      /\ published' = PublishedAfterPublish
      /\ IF ready THEN
           /\ storage' = [StorageAfterPublish EXCEPT ![t][b] = "capturing"]
           /\ active' = t /\ activeBank' = b /\ activeLaunch' = launch /\ generation' = generation + 1
         ELSE
           /\ storage' = StorageAfterPublish /\ active' = 0 /\ activeBank' = 0 /\ UNCHANGED <<generation, activeLaunch>>
    ELSE IF valid THEN UNCHANGED <<active, activeBank, activeLaunch, generation, latest, storage, playing, published>>
    ELSE
      /\ storage' = IF Mutation = "admitAfterInvalid" /\ ready
                       THEN [[storage EXCEPT ![active][activeBank] = "empty"] EXCEPT ![t][b] = "capturing"]
                       ELSE [storage EXCEPT ![active][activeBank] = "empty"]
      /\ active' = IF Mutation = "admitAfterInvalid" /\ ready THEN t ELSE 0
      /\ activeBank' = IF Mutation = "admitAfterInvalid" /\ ready THEN b ELSE 0
      /\ activeLaunch' = IF Mutation = "admitAfterInvalid" /\ ready THEN launch ELSE activeLaunch
      /\ generation' = IF Mutation = "admitAfterInvalid" /\ ready THEN generation + 1 ELSE generation
      /\ UNCHANGED <<latest, playing, published>>
 /\ event' = Event(kind, valid, ready)
Stop == /\ active' = 0 /\ activeBank' = 0
        /\ storage' = IF active = 0 THEN storage ELSE [storage EXCEPT ![active][activeBank] = "empty"]
        /\ playing' = [t \in Takes |-> [b \in Banks |-> FALSE]]
        /\ event' = [EmptyEvent EXCEPT !.kind = "stop"]
        /\ UNCHANGED <<generation, latest, published, activeLaunch>>
StopComplete == /\ active # 0 /\ latest' = LatestAfterPublish /\ storage' = StorageAfterPublish
                /\ published' = PublishedAfterPublish /\ active' = 0 /\ activeBank' = 0
                /\ playing' = [t \in Takes |-> [b \in Banks |-> FALSE]]
                /\ event' = [EmptyEvent EXCEPT !.kind = "stop-complete"]
                /\ UNCHANGED <<generation, activeLaunch>>
FaultBeforePublication == /\ active # 0 /\ active' = 0 /\ activeBank' = 0
                         /\ storage' = [storage EXCEPT ![active][activeBank] = "empty"]
                         /\ playing' = [t \in Takes |-> [b \in Banks |-> FALSE]]
                         /\ event' = [EmptyEvent EXCEPT !.kind = "fault"]
                         /\ UNCHANGED <<generation, latest, published, activeLaunch>>
FaultAfterPublication == /\ active # 0 /\ latest' = LatestAfterPublish /\ storage' = StorageAfterPublish
                        /\ active' = 0 /\ activeBank' = 0
                        /\ playing' = [t \in Takes |-> [b \in Banks |-> FALSE]]
                        /\ published' = PublishedAfterPublish
                        /\ event' = [EmptyEvent EXCEPT !.kind = "fault"]
                        /\ UNCHANGED <<generation, activeLaunch>>
Done == /\ generation = MaxCaptures /\ active = 0 /\ UNCHANGED vars
Next == \/ \E t \in Takes, b \in Banks, launch \in LaunchPolicies : Begin(t, b, launch)
        \/ Finish
        \/ \E t \in Takes, b \in Banks \cup {0}, ready \in BOOLEAN, launch \in LaunchPolicies : Combined(t, b, ready, launch)
        \/ \E t \in Takes, b \in Banks \cup {0}, valid \in BOOLEAN, ready \in BOOLEAN, launch \in LaunchPolicies : Boundary("independent", t, b, valid, ready, launch)
        \/ \E t \in Takes, b \in Banks \cup {0}, valid \in BOOLEAN, ready \in BOOLEAN, launch \in LaunchPolicies : Boundary("automatic", t, b, valid, ready, launch)
        \/ Stop \/ StopComplete \/ FaultBeforePublication \/ FaultAfterPublication \/ Done
TypeOK == /\ activeLaunch \in LaunchPolicies /\ active \in Takes \cup {0} /\ activeBank \in Banks \cup {0}
          /\ generation \in Generations /\ latest \in [Takes -> Banks \cup {0}]
          /\ storage \in [Takes -> [Banks -> {"empty", "capturing", "committed"}]]
          /\ playing \in [Takes -> [Banks -> BOOLEAN]]
          /\ published \in [Generations -> 0..1]
OneCaptureWriter == Cardinality({p \in Takes \X Banks : storage[p[1]][p[2]] = "capturing"}) = IF active = 0 THEN 0 ELSE 1
CaptureBankNotLatest == active # 0 => /\ storage[active][activeBank] = "capturing" /\ latest[active] # activeBank
LatestIsComplete == \A t \in Takes : latest[t] # 0 => storage[t][latest[t]] = "committed"
PublishedOnce == \A g \in Generations : published[g] <= 1
CombinedRejectPreservesDraft == event.kind = "combined" /\ ~event.ready =>
 /\ active = event.take /\ activeBank = event.bank /\ published[event.gen] = 0
IndependentCommitSurvivesFailedArm == event.kind = "independent" /\ event.valid /\ ~event.ready =>
 /\ latest[event.take] = event.bank /\ published[event.gen] = 1 /\ active = 0
InvalidReleaseCannotAdmit == event.kind \in {"independent", "automatic"} /\ ~event.valid =>
 /\ active = 0 /\ published[event.gen] = 0
SuccessfulPublicationAutoplays == event.launch = "autoplay" /\ event.kind \in {"commit", "combined", "independent", "automatic"} /\ event.valid
 /\ (event.kind # "combined" \/ event.ready) => playing[event.take][event.bank]
StoreOnlyPublicationDoesNotLaunch == event.launch = "store-only" /\ event.kind \in {"commit", "combined", "independent", "automatic"} /\ event.valid
 /\ (event.kind # "combined" \/ event.ready) => ~playing[event.take][event.bank]
AutomaticEndpointCompletes == event.kind = "automatic" /\ event.valid =>
 /\ latest[event.take] = event.bank /\ published[event.gen] = 1
Spec == Initial /\ [][Next]_vars
=============================================================================
