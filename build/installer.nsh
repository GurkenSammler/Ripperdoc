; RIPPERDOC: Vor dem Deinstallieren fragt RIPPERDOC selbst (eigener Dialog, Deutsch/Englisch), ob noch
; eingebundene Mods aus dem Spielordner sollen (PURGE). Exit-Code 2 = Deinstallation abbrechen.
; Nicht bei Updates (der alte Deinstaller läuft dann still mit --updated) und nicht bei ausdrücklichem /S.
!macro customUnInit
  ${ifNot} ${isUpdated}
    ${GetParameters} $R0
    ClearErrors
    ${GetOptions} $R0 "/S" $R1
    ${if} ${Errors}
      ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --uninstall' $R2
      ${if} $R2 == 2
        Quit
      ${endIf}
    ${endIf}
  ${endIf}
!macroend
