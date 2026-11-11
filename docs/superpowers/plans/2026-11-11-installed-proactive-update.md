# Installed preview update plan

## Task1 — release metadata and validation
- [ ] Align package/lock rootversions, addonTOC and emittedcaptureVersion to0.13.0; retainpreview and1.0hold. Dependencies, gamebuild/data/schema/protocol unchanged.
- [ ] Add current0.13release notes/changelog/currentrelease instructions documentingreviewedCompass/Profession/Map/sidebar/privacy/dataqualification andheldrealclient/provider/audio/updater/performancechecks. Preservehistoricaldocs andsealedartifacts.
- [ ] EnsuretagCIincludesnewacquisitioncheck/Compass/Profession/Mapgates inexistingrelease+validationworkflows withoutremovingrequiredchecks.
- [ ] Meaningfulversionalignment regression ifneeded, focusedaddon/setup/update/workflow tests; report/scopedcommit+freshindependentreview. No liveapprestart,paid/game/credentials,publicpush/tag byimplementer.

## Task2 — authenticated publication
- [ ] Parentreview/focusedgates; confirm originmainancestor and tagunique; fastforwardpublicmain andpushv0.13.0 toexistingpipeline.
- [ ] FollowCIinthissession, resolveconcretefailures/reviewchangeswithoutdestructive tag rewrites; no recurringjobs.
- [ ] Verifypublicrelease, authenticmanifestandactualinstallerdownloadbytes/hash; verify0.12.3 clientselects0.13.0withoutinstallation. Reportexactstatus+link, hold1.0anduserrestart.
