; Nomi NSIS 定制：只删构建清单，用户文件原地不动。
; 0.24.0 默认卸载器会整目录删除；customInit 在模板运行登记文件前将不可信卸载器替换成本版。
; 替换失败立即中止，没有旧删除者 fallback，也没有用户文件搬移/恢复协议。
; 文档化钩子仅 customHeader/customInit/customRemoveFiles/customInstall；26.15.3 模板指纹由普查守住。
; 设计卡 docs/plan/2026-10-29-installer-keep-user-files.md；方向裁定 docs/engineering/direction-checks/2026-10-30-installer-keep-user-files.md。

!ifdef ONE_CLICK
  !error "build/installer.nsh assumes the assisted installer (nsis.oneClick = false)"
!endif
!ifdef INSTALL_MODE_PER_ALL_USERS
  !error "build/installer.nsh assumes the per-user / per-machine choice (nsis.perMachine is not true)"
!endif
!ifdef APP_PACKAGE_URL
  !error "build/installer.nsh does not support the web installer"
!endif
!ifndef APP_64
  !error "build/installer.nsh needs the x64 app package"
!endif
!ifdef APP_32
  !error "build/installer.nsh: the installer manifest only covers x64"
!endif
!ifdef APP_ARM64
  !error "build/installer.nsh: the installer manifest only covers x64"
!endif

!include "LogicLib.nsh"

; 构建时生成的清单：scripts/packaging/installer-manifest.cjs 在 afterPack 里写出（剪完平台二进制之后）。
; NSIS 3.04 Windows !include 只按反斜杠拆目录/文件名；Unix makensis 会转换反斜杠。
!include "${PROJECT_DIR}\.tmp\installer-manifest\${PRODUCT_FILENAME}-x64.nsh"
!if "${NOMI_INSTALLER_MANIFEST_VERSION}" S!= "${VERSION}"
  !error "stale installer manifest (${NOMI_INSTALLER_MANIFEST_VERSION}, building ${VERSION}): package with electron-builder so afterPack regenerates it"
!endif

!define NOMI_REMOVES_ONLY_OWN_FILES "RemovesOnlyOwnFiles"

; ============================================================== 1. 卸载程序：只删清单里的条目

!macro nomiUnCreateOldInstallDir _P
  CreateDirectory "$PLUGINSDIR\old-install\${_P}"
!macroend

!macro nomiUnMoveOwnedFile _P
  Push "${_P}"
  Call un.nomiMoveOwnedFile
!macroend

!macro nomiUnRestoreOwnedFile _P
  Push "${_P}"
  Call un.nomiRestoreOwnedFile
!macroend

!macro nomiUnDeleteOwnedFile _P
  Delete "$INSTDIR\${_P}"
!macroend

!macro nomiUnRemoveDirIfEmpty _P
  RMDir "$INSTDIR\${_P}"
!macroend

; 替换模板 uninstaller.nsh:160-188 的默认删除。升级（--updated）时保住模板的原子语义：
; 清单里的文件逐个挪进 $PLUGINSDIR\old-install（卸载程序退出时连同 $PLUGINSDIR 一起清掉），
; 任一个挪不动就把挪过的全部挪回、用模板同一句 Abort 失败；普通卸载逐个 Delete。
; 最后目录按「最深在前」非递归删、$INSTDIR 空了才删：用户的东西在哪个目录里，那个目录就留着。
!macro customRemoveFiles
  ${If} ${isUpdated}
    StrCpy $nomiUnBusy ""
    !insertmacro NOMI_INSTALLER_DIRS nomiUnCreateOldInstallDir
    !insertmacro NOMI_INSTALLER_FILES nomiUnMoveOwnedFile
    !ifdef UNINSTALLER_ICON
      !insertmacro nomiUnMoveOwnedFile "uninstallerIcon.ico"
    !endif
    ; 卸载程序在原地运行时改不了自己的名字，照模板忽略（uninstaller.nsh:72-74）。
    ClearErrors
    Rename "$INSTDIR\${UNINSTALL_FILENAME}" "$PLUGINSDIR\old-install\${UNINSTALL_FILENAME}"
    ClearErrors
    ${If} $nomiUnBusy != ""
      DetailPrint "File is busy, aborting: $nomiUnBusy"
      !insertmacro NOMI_INSTALLER_FILES nomiUnRestoreOwnedFile
      !ifdef UNINSTALLER_ICON
        !insertmacro nomiUnRestoreOwnedFile "uninstallerIcon.ico"
      !endif
      !insertmacro nomiUnRestoreOwnedFile "${UNINSTALL_FILENAME}"
      Abort `Can't rename "$INSTDIR" to "$PLUGINSDIR\old-install".`
    ${EndIf}
  ${Else}
    !insertmacro NOMI_INSTALLER_FILES nomiUnDeleteOwnedFile
    !ifdef UNINSTALLER_ICON
      Delete "$INSTDIR\uninstallerIcon.ico"
    !endif
    Delete "$INSTDIR\${UNINSTALL_FILENAME}"
  ${EndIf}
  ; 当前目录不能停在 $INSTDIR 里，否则它删不掉（模板同样先 SetOutPath $TEMP）。
  SetOutPath $TEMP
  !insertmacro NOMI_INSTALLER_DIRS_DEEPEST_FIRST nomiUnRemoveDirIfEmpty
  RMDir "$INSTDIR"
!macroend

; ============================================================== 2. 安装程序：模板执行前换掉不可信卸载器，用户文件原地不动

!macro nomiReplaceRegisteredUninstaller _ROOT
  StrCpy $nomiUninstallKey "${UNINSTALL_REGISTRY_KEY}"
  ReadRegStr $nomiUninstaller ${_ROOT} "$nomiUninstallKey" UninstallString
  ${If} $nomiUninstaller == ""
    !ifdef UNINSTALL_REGISTRY_KEY_2
      StrCpy $nomiUninstallKey "${UNINSTALL_REGISTRY_KEY_2}"
      ReadRegStr $nomiUninstaller ${_ROOT} "$nomiUninstallKey" UninstallString
    !endif
  ${EndIf}
  Push $nomiUninstaller
  Call GetInQuotes
  Pop $nomiUninstaller
  ${If} $nomiUninstaller != ""
  ${AndIf} ${FileExists} "$nomiUninstaller"
    ReadRegStr $nomiMarker ${_ROOT} "${INSTALL_REGISTRY_KEY}" "${NOMI_REMOVES_ONLY_OWN_FILES}"
    ReadRegStr $nomiVersion ${_ROOT} "$nomiUninstallKey" DisplayVersion
    ${If} $nomiMarker == ""
    ${OrIf} $nomiMarker != $nomiVersion
      StrCpy $nomiFailure "无法准备临时卸载程序 / Could not prepare the temporary uninstaller"
      ClearErrors
      InitPluginsDir
      ${If} ${Errors}
        Goto nomiReplacementFailed
      ${EndIf}
      ClearErrors
      File "/oname=$PLUGINSDIR\nomi-safe-uninstaller.exe" "${UNINSTALLER_OUT_FILE}"
      ${If} ${Errors}
        Goto nomiReplacementFailed
      ${EndIf}
      StrCpy $nomiFailure "无法替换登记的卸载程序（可能被占用或没有写入权限） / Could not replace the registered uninstaller (it may be in use or write permission may be missing)"
      ; REPLACE_EXISTING | COPY_ALLOWED | WRITE_THROUGH: TEMP 和安装目录可能跨卷。
      System::Call 'kernel32::MoveFileExW(w "$PLUGINSDIR\nomi-safe-uninstaller.exe", w "$nomiUninstaller", i 11) i .r0'
      ${If} $0 == 0
        Goto nomiReplacementFailed
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!macro customInit
  Call nomiReplaceUntrustedUninstaller
!macroend

!macro customInstall
  WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "${NOMI_REMOVES_ONLY_OWN_FILES}" "${VERSION}"
!macroend

; customHeader 插在 installer.nsi:45-47：common.nsh、multiUser.nsh、UAC 都已引入，安装段之前。
!macro customHeader
  !ifdef BUILD_UNINSTALLER
    Var nomiUnBusy

    Function un.nomiMoveOwnedFile
      Exch $0
      ${If} $nomiUnBusy == ""
      ${AndIf} ${FileExists} "$INSTDIR\$0"
        ClearErrors
        Rename "$INSTDIR\$0" "$PLUGINSDIR\old-install\$0"
        ${If} ${Errors}
          StrCpy $nomiUnBusy "$INSTDIR\$0"
        ${EndIf}
      ${EndIf}
      Pop $0
    FunctionEnd

    Function un.nomiRestoreOwnedFile
      Exch $0
      ${If} ${FileExists} "$PLUGINSDIR\old-install\$0"
        Rename "$PLUGINSDIR\old-install\$0" "$INSTDIR\$0"
      ${EndIf}
      Pop $0
    FunctionEnd
  !else
    Var nomiUninstallKey
    Var nomiUninstaller
    Var nomiMarker
    Var nomiVersion
    Var nomiFailure

    Function nomiReplaceUntrustedUninstaller
      ; 只替换登记的卸载程序；不移动用户文件，不认领任何旁边目录。
      SetOutPath $TEMP
      !insertmacro nomiReplaceRegisteredUninstaller HKCU
      ${If} ${UAC_IsAdmin}
        !insertmacro nomiReplaceRegisteredUninstaller HKLM
      ${EndIf}
      ClearErrors
      Return
      nomiReplacementFailed:
        MessageBox MB_OK|MB_ICONSTOP|MB_TOPMOST|MB_SETFOREGROUND "Nomi 没有更新。$nomiFailure：$nomiUninstaller。为避免删除你的文件，更新已经停止。请关闭占用程序并检查写入权限，再更新 Nomi。$\r$\n$\r$\nNomi was not updated. $nomiFailure: $nomiUninstaller. The update stopped to protect your files. Close programs using it, check write permission, and update Nomi again."
        SetErrorLevel 2
        Quit
    FunctionEnd
  !endif
!macroend
