; Nomi 对 electron-builder NSIS 模板的定制（package.json 的 build.nsis.include 指向这里）。
;
; 只管一件事：升级 / 卸载只删安装器自己装的东西，用户放进安装目录的文件一个都不删。
; 起因：electron-builder 默认卸载段是 RMDir /r $INSTDIR（templates/nsis/uninstaller.nsh:160-188），
; 2026-10-29 一位用户把项目放在安装目录下，0.24.0 一升级 5 个项目全没了，回收站里也没有。
; 设计卡：docs/plan/2026-10-29-installer-keep-user-files.md。模板版本 electron-builder 26.15.3，
; 用到的钩子和插入点由 tests/installer/installerScenarios.test.mjs 的模板指纹钉住，升级 electron-builder 时那里先红。
;
; 三块：
;   1. 卸载程序（BUILD_UNINSTALLER 那一轮编译）：customRemoveFiles 只删构建时生成的清单里的条目，目录一律非递归删。
;   2. 安装程序：从卸载程序还会整目录删的旧版本（0.24.0 及更早，注册表里没有可信的 RemovesOnlyOwnFiles）升上来时，
;      在旧卸载程序跑之前把安装目录顶层不属于安装器的条目同盘挪到 <安装目录>.nomi-keep，旧卸载程序一结束就挪回。
;   3. 安装程序在注册表写 RemovesOnlyOwnFiles = 本版本号：下次升级就知道登记的卸载程序只删自己的，不必再挪。
;
; 编译时有两道 -WX（警告即错误）的 makensis：安装程序一轮、卸载程序一轮。各轮只声明、只定义自己用到的变量和函数。

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

; 这几个字面量和 tests/installer/scenarios.mjs 逐字对账（普查测试），Windows 安装作业按它们找旁边目录和注册表。
!define NOMI_KEEP_SUFFIX ".nomi-keep"
!define NOMI_KEEP_README "NOMI-INSTALLER-KEEP.txt"
!define NOMI_REMOVES_ONLY_OWN_FILES "RemovesOnlyOwnFiles"
!define NOMI_KEEP_RENAME_TRIES 20
!define NOMI_APP_EXIT_POLLS 30

; 定义了 customCheckAppRunning 之后，模板不再引入这两样（templates/nsis/include/allowOnlyOneInstallerInstance.nsh:5-8），
; 而下面原样调用的默认检查要用它们：安装、卸载两轮都要。
!include "getProcessInfo.nsh"
Var pid

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

; ============================================================== 2. 安装程序：旧卸载程序跑之前挪开、跑完挪回

; 模板的「应用还开着」检查原样跑（IS_POWERSHELL_AVAILABLE + _CHECK_APP_RUNNING，allowOnlyOneInstallerInstance.nsh:37-42），
; 等 Nomi 真的关了再挪：quitAndInstall 是先起安装程序再退应用，应用可能还占着项目目录。
; 卸载程序那一轮也会插入这个宏（un.checkAppRunning），那里只跑默认检查。
!macro customCheckAppRunning
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro _CHECK_APP_RUNNING
  !ifndef BUILD_UNINSTALLER
    Call nomiKeepAside
  !endif
!macroend

; 替换模板 installUtil.nsh:108-134 对 SHELL_CONTEXT 那一轮旧卸载结果的默认处理：语义逐句照抄，只插入「挪回」。
; 所有用户安装（$installMode == all）之后还有 HKEY_CURRENT_USER 那一轮，挪回放到那一轮之后；失败退出前一律先挪回。
!macro customUnInstallCheck
  ${If} ${Errors}
    DetailPrint `Uninstall was not successful. Not able to launch uninstaller!`
    ${If} $installMode != "all"
      Call nomiRestoreKept
    ${EndIf}
  ${ElseIf} $R0 != 0
    Call nomiRestoreKept
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(uninstallFailed): $R0"
    DetailPrint `Uninstall was not successful. Uninstaller error code: $R0.`
    SetErrorLevel 2
    Quit
  ${ElseIf} $installMode != "all"
    Call nomiRestoreKept
  ${EndIf}
!macroend

!macro customUnInstallCheckCurrentUser
  ${If} ${Errors}
    DetailPrint `Uninstall was not successful. Not able to launch uninstaller!`
  ${ElseIf} $R0 != 0
    Call nomiRestoreKept
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(uninstallFailed): $R0"
    DetailPrint `Uninstall was not successful. Uninstaller error code: $R0.`
    SetErrorLevel 2
    Quit
  ${EndIf}
  Call nomiRestoreKept
!macroend

; 兜底挪回（正常情况下旧卸载程序一结束就挪回了，这里什么都不做），然后写标记：
; 本版本登记的卸载程序只删清单里的条目。值是写入它的版本，只在等于同一根键卸载项的 DisplayVersion 时才被信。
!macro customInstall
  Call nomiRestoreKept
  WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "${NOMI_REMOVES_ONLY_OWN_FILES}" "${VERSION}"
!macroend

!macro nomiOwnedName _N
  StrCmp $nomiName "${_N}" 0 +2
  StrCpy $nomiOk "0"
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
    Var nomiKeep1
    Var nomiKeep2
    Var nomiCuLoc
    Var nomiCand
    Var nomiL
    Var nomiH
    Var nomiSlot
    Var nomiName
    Var nomiFailed
    Var nomiFind
    Var nomiFh
    Var nomiTry
    Var nomiCount
    Var nomiMoved
    Var nomiOk
    Var nomiTmp

    ; $nomiCand 去掉结尾的反斜杠（注册表 InstallLocation 一般不带，/D= 可能带）。
    Function nomiNormalizeCand
      StrCpy $nomiTmp $nomiCand 1 -1
      ${If} $nomiTmp == "\"
        StrCpy $nomiCand $nomiCand -1
      ${EndIf}
    FunctionEnd

    ; $nomiName 是 $nomiL 顶层的一个条目：不是 . / ..、不在清单顶层名里、也不是卸载程序 → $nomiOk = 1。
    Function nomiIsForeign
      StrCpy $nomiOk "1"
      !insertmacro nomiOwnedName "."
      !insertmacro nomiOwnedName ".."
      !insertmacro NOMI_INSTALLER_TOP_LEVEL_NAMES nomiOwnedName
      !insertmacro nomiOwnedName "${UNINSTALL_FILENAME}"
      !ifdef UNINSTALLER_ICON
        !insertmacro nomiOwnedName "uninstallerIcon.ico"
      !endif
    FunctionEnd

    Function nomiCountForeign
      StrCpy $nomiCount 0
      FindFirst $nomiFind $nomiName "$nomiL\*.*"
      ${DoWhile} $nomiName != ""
        Call nomiIsForeign
        ${If} $nomiOk == "1"
          IntOp $nomiCount $nomiCount + 1
        ${EndIf}
        FindNext $nomiFind $nomiName
      ${Loop}
      FindClose $nomiFind
    FunctionEnd

    ; 把 $nomiH 里除说明文件以外的条目挪回 $nomiL；$nomiL 里已有同名的不覆盖。
    ; 边枚举边挪（同模板 un.restoreFiles），一轮挪动过就再扫一轮；结束时 $nomiCount = 留在 $nomiH 的条目数。
    Function nomiMoveBack
      ${Do}
        StrCpy $nomiMoved 0
        StrCpy $nomiCount 0
        FindFirst $nomiFind $nomiName "$nomiH\*.*"
        ${DoWhile} $nomiName != ""
          ${If} $nomiName != "."
          ${AndIf} $nomiName != ".."
          ${AndIf} $nomiName != "${NOMI_KEEP_README}"
            ${If} ${FileExists} "$nomiL\$nomiName"
              IntOp $nomiCount $nomiCount + 1
            ${Else}
              ClearErrors
              Rename "$nomiH\$nomiName" "$nomiL\$nomiName"
              ${If} ${Errors}
                IntOp $nomiCount $nomiCount + 1
              ${Else}
                IntOp $nomiMoved $nomiMoved + 1
                DetailPrint "Nomi: moved back $nomiL\$nomiName"
              ${EndIf}
            ${EndIf}
          ${EndIf}
          FindNext $nomiFind $nomiName
        ${Loop}
        FindClose $nomiFind
      ${LoopUntil} $nomiMoved == 0
    FunctionEnd

    ; 上一次更新被打断留下的旁边目录（有说明文件才认）：挪回 $nomiCand。有同名冲突就停下让用户处理。
    Function nomiRecover
      Call nomiNormalizeCand
      ${If} $nomiCand == ""
        Return
      ${EndIf}
      StrCpy $nomiL $nomiCand
      StrCpy $nomiH "$nomiL${NOMI_KEEP_SUFFIX}"
      ${IfNot} ${FileExists} "$nomiH\${NOMI_KEEP_README}"
        Return
      ${EndIf}
      DetailPrint "Nomi: restoring files an interrupted update left in $nomiH"
      CreateDirectory "$nomiL"
      Call nomiMoveBack
      ${If} $nomiCount == 0
        Delete "$nomiH\${NOMI_KEEP_README}"
        RMDir "$nomiH"
        Return
      ${EndIf}
      MessageBox MB_OK|MB_ICONEXCLAMATION|MB_TOPMOST|MB_SETFOREGROUND "Nomi 没有更新。上一次更新被中断时，你的文件被临时挪到了 $nomiH，其中有的和 $nomiL 里现有的同名，没有覆盖。请把 $nomiH 里的内容手动合并回 $nomiL 后，再更新 Nomi。$\r$\n$\r$\nNomi was not updated. An earlier update was interrupted and left your files in $nomiH; some of them have the same names as files now in $nomiL and were not overwritten. Merge the contents of $nomiH back into $nomiL by hand, then update Nomi again."
      SetErrorLevel 2
      Quit
    FunctionEnd

    ; 旧版应用还在退出时，它的 exe 打不开写；最多等 NOMI_APP_EXIT_POLLS × 0.5 秒（UAC 内层实例模板不做应用检查，靠这里兜）。
    Function nomiWaitAppExit
      StrCpy $nomiTry 0
      ${Do}
        ${IfNot} ${FileExists} "$nomiL\${APP_EXECUTABLE_FILENAME}"
          ${Break}
        ${EndIf}
        ClearErrors
        FileOpen $nomiFh "$nomiL\${APP_EXECUTABLE_FILENAME}" a
        ${IfNot} ${Errors}
          FileClose $nomiFh
          ${Break}
        ${EndIf}
        IntOp $nomiTry $nomiTry + 1
        ${If} $nomiTry >= ${NOMI_APP_EXIT_POLLS}
          ${Break}
        ${EndIf}
        Sleep 500
      ${Loop}
    FunctionEnd

    ; $nomiL\$nomiName → $nomiH\$nomiName，被占用时重试（杀毒软件、索引器常常只占一会儿）。成功 $nomiOk = 1。
    Function nomiRenameAside
      StrCpy $nomiTry 0
      ${Do}
        ClearErrors
        Rename "$nomiL\$nomiName" "$nomiH\$nomiName"
        ${IfNot} ${Errors}
          StrCpy $nomiOk "1"
          DetailPrint "Nomi: moved aside $nomiL\$nomiName"
          ${Break}
        ${EndIf}
        IntOp $nomiTry $nomiTry + 1
        ${If} $nomiTry >= ${NOMI_KEEP_RENAME_TRIES}
          StrCpy $nomiOk "0"
          ${Break}
        ${EndIf}
        Sleep 500
      ${Loop}
    FunctionEnd

    ; 旁边目录做不了：先把本次已挪开的位置挪回，再说明原因、中止（什么都没删）。
    Function nomiAbortNoHolding
      Call nomiRestoreKept
      MessageBox MB_OK|MB_ICONSTOP|MB_TOPMOST|MB_SETFOREGROUND "Nomi 没有更新，你的文件一个都没动。$\r$\n安装目录 $nomiL 里有不属于 Nomi 的文件，更新前要先把它们临时挪到 $nomiH，这一步做不了。请把这些文件移出安装目录，或把 Nomi 装到单独的文件夹后再更新。$\r$\n$\r$\nNomi was not updated and none of your files were changed.$\r$\nThe installation folder $nomiL contains files that are not part of Nomi. The update has to move them to $nomiH first, and that is not possible. Move those files out of the installation folder, or install Nomi into a folder of its own, then update again."
      SetErrorLevel 2
      Quit
    FunctionEnd

    ; 某个条目挪不开：本位置已挪的挪回、删掉说明文件和旁边目录，其他位置也挪回，再说明是哪个条目、中止。
    Function nomiAbortMoveFailed
      StrCpy $nomiFailed $nomiName
      Call nomiMoveBack
      ${If} $nomiCount == 0
        Delete "$nomiH\${NOMI_KEEP_README}"
        RMDir "$nomiH"
        DeleteRegValue HKCU "${INSTALL_REGISTRY_KEY}${NOMI_KEEP_SUFFIX}" "Pending$nomiSlot"
        DeleteRegKey /ifempty HKCU "${INSTALL_REGISTRY_KEY}${NOMI_KEEP_SUFFIX}"
      ${EndIf}
      StrCpy $nomiTmp $nomiCount
      Call nomiRestoreKept
      ${If} $nomiTmp == 0
        MessageBox MB_OK|MB_ICONSTOP|MB_TOPMOST|MB_SETFOREGROUND "Nomi 没有更新，你的文件一个都没动。$\r$\n安装目录 $nomiL 里的「$nomiFailed」挪不开（可能正被别的程序打开）。请关掉占用它的程序，再重新更新 Nomi。$\r$\n$\r$\nNomi was not updated and none of your files were changed.$\r$\n'$nomiFailed' in the installation folder $nomiL could not be moved (another program may be using it). Close that program and update Nomi again."
      ${Else}
        MessageBox MB_OK|MB_ICONSTOP|MB_TOPMOST|MB_SETFOREGROUND "Nomi 没有更新。安装目录 $nomiL 里的「$nomiFailed」挪不开（可能正被别的程序打开）；已经挪开的文件有一部分没能挪回，它们完好地放在 $nomiH，请手动挪回 $nomiL。$\r$\n$\r$\nNomi was not updated. '$nomiFailed' in the installation folder $nomiL could not be moved (another program may be using it). Some files that were already moved could not be moved back; they are safe in $nomiH. Move them back to $nomiL by hand."
      ${EndIf}
      SetErrorLevel 2
      Quit
    FunctionEnd

    ; 保护一个位置（$nomiL，槽位 $nomiSlot）：顶层有外来条目才动手；先写待恢复记录和说明文件，再逐个挪开。
    Function nomiProtect
      ${IfNot} ${FileExists} "$nomiL\*.*"
        Return
      ${EndIf}
      Call nomiCountForeign
      ${If} $nomiCount == 0
        Return
      ${EndIf}
      StrCpy $nomiH "$nomiL${NOMI_KEEP_SUFFIX}"
      StrLen $nomiTmp $nomiL
      ; 盘符根目录旁边没有同一个卷上的位置可挪；旁边目录已存在（不是我们的、或上次中断没清干净）也不碰。
      ${If} $nomiTmp <= 3
      ${OrIf} ${FileExists} "$nomiH"
        Call nomiAbortNoHolding
      ${EndIf}
      Call nomiWaitAppExit
      WriteRegStr HKCU "${INSTALL_REGISTRY_KEY}${NOMI_KEEP_SUFFIX}" "Pending$nomiSlot" "$nomiL"
      ClearErrors
      CreateDirectory "$nomiH"
      ${If} ${Errors}
        DeleteRegValue HKCU "${INSTALL_REGISTRY_KEY}${NOMI_KEEP_SUFFIX}" "Pending$nomiSlot"
        Call nomiAbortNoHolding
      ${EndIf}
      ClearErrors
      FileOpen $nomiFh "$nomiH\${NOMI_KEEP_README}" w
      ${If} ${Errors}
        RMDir "$nomiH"
        DeleteRegValue HKCU "${INSTALL_REGISTRY_KEY}${NOMI_KEEP_SUFFIX}" "Pending$nomiSlot"
        Call nomiAbortNoHolding
      ${EndIf}
      FileWriteUTF16LE /BOM $nomiFh "Nomi 安装程序在更新时，把安装目录 $nomiL 里不属于 Nomi 的文件临时挪到了这里，更新结束会自动挪回去。$\r$\n如果你看到这个文件夹，说明上一次更新被中断了：重新运行 Nomi 安装程序会自动挪回；也可以手动把这里除本说明以外的所有内容挪回 $nomiL。$\r$\n$\r$\nWhile updating, the Nomi installer temporarily moved the files in the installation folder $nomiL that are not part of Nomi to this folder, and normally moves them back automatically.$\r$\nIf you can see this folder, the last update was interrupted: run the Nomi installer again, or move everything here except this file back to $nomiL.$\r$\n"
      FileClose $nomiFh
      DetailPrint "Nomi: moving $nomiCount entries that are not part of Nomi from $nomiL to $nomiH"
      ${Do}
        StrCpy $nomiMoved 0
        FindFirst $nomiFind $nomiName "$nomiL\*.*"
        ${DoWhile} $nomiName != ""
          Call nomiIsForeign
          ${If} $nomiOk == "1"
            Call nomiRenameAside
            ${If} $nomiOk != "1"
              FindClose $nomiFind
              Call nomiAbortMoveFailed
            ${EndIf}
            IntOp $nomiMoved $nomiMoved + 1
          ${EndIf}
          FindNext $nomiFind $nomiName
        ${Loop}
        FindClose $nomiFind
      ${LoopUntil} $nomiMoved == 0
      ${If} $nomiSlot == "1"
        StrCpy $nomiKeep1 $nomiL
      ${Else}
        StrCpy $nomiKeep2 $nomiL
      ${EndIf}
    FunctionEnd

    ; 卸载程序是否可信只看注册表：$nomiCand 位置的 RemovesOnlyOwnFiles 等于同一根键卸载项的 DisplayVersion 才算。
    Function nomiKeepAside
      ; 安装程序的当前目录（.onInit 设成 $INSTDIR）会占住安装目录，先挪开。
      SetOutPath $TEMP
      StrCpy $nomiKeep1 ""
      StrCpy $nomiKeep2 ""
      ; 1. 上一次被打断留下的：待恢复记录、两个注册表安装位置、这次的安装目录，都看一眼。
      ReadRegStr $nomiCand HKCU "${INSTALL_REGISTRY_KEY}${NOMI_KEEP_SUFFIX}" "Pending1"
      Call nomiRecover
      ReadRegStr $nomiCand HKCU "${INSTALL_REGISTRY_KEY}${NOMI_KEEP_SUFFIX}" "Pending2"
      Call nomiRecover
      ReadRegStr $nomiCand HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
      Call nomiRecover
      ReadRegStr $nomiCand HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
      Call nomiRecover
      StrCpy $nomiCand $INSTDIR
      Call nomiRecover
      DeleteRegKey HKCU "${INSTALL_REGISTRY_KEY}${NOMI_KEEP_SUFFIX}"
      ; 2. 当前用户的安装（旧卸载程序按 /currentuser 跑、删的就是这里）。
      ReadRegStr $nomiCand HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
      Call nomiNormalizeCand
      StrCpy $nomiCuLoc $nomiCand
      ${If} $nomiCand != ""
        ReadRegStr $nomiTmp HKCU "${INSTALL_REGISTRY_KEY}" "${NOMI_REMOVES_ONLY_OWN_FILES}"
        ReadRegStr $nomiName HKCU "${UNINSTALL_REGISTRY_KEY}" DisplayVersion
        ${If} $nomiTmp == ""
        ${OrIf} $nomiTmp != $nomiName
          StrCpy $nomiL $nomiCand
          StrCpy $nomiSlot "1"
          Call nomiProtect
        ${EndIf}
      ${EndIf}
      ; 3. 所有用户的安装：只有管理员身份才可能跑到 /allusers 那一轮旧卸载（模板 installSection.nsh:52-58）。
      ${If} ${UAC_IsAdmin}
        ReadRegStr $nomiCand HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
        Call nomiNormalizeCand
        ${If} $nomiCand != ""
        ${AndIf} $nomiCand != $nomiCuLoc
          ReadRegStr $nomiTmp HKLM "${INSTALL_REGISTRY_KEY}" "${NOMI_REMOVES_ONLY_OWN_FILES}"
          ReadRegStr $nomiName HKLM "${UNINSTALL_REGISTRY_KEY}" DisplayVersion
          ${If} $nomiTmp == ""
          ${OrIf} $nomiTmp != $nomiName
            StrCpy $nomiL $nomiCand
            StrCpy $nomiSlot "2"
            Call nomiProtect
          ${EndIf}
        ${EndIf}
      ${EndIf}
    FunctionEnd

    ; 挪回一个位置（$nomiL，槽位 $nomiSlot）。挪不全就留着旁边目录和待恢复记录，说明在哪里，安装继续。
    Function nomiRestoreOne
      StrCpy $nomiH "$nomiL${NOMI_KEEP_SUFFIX}"
      CreateDirectory "$nomiL"
      Call nomiMoveBack
      ${If} $nomiCount == 0
        Delete "$nomiH\${NOMI_KEEP_README}"
        RMDir "$nomiH"
        DeleteRegValue HKCU "${INSTALL_REGISTRY_KEY}${NOMI_KEEP_SUFFIX}" "Pending$nomiSlot"
        DeleteRegKey /ifempty HKCU "${INSTALL_REGISTRY_KEY}${NOMI_KEEP_SUFFIX}"
      ${Else}
        MessageBox MB_OK|MB_ICONEXCLAMATION|MB_TOPMOST|MB_SETFOREGROUND "你的一部分文件还在 $nomiH（完好），没能挪回 $nomiL（那里已有同名的）。请手动把它们挪回去。$\r$\n$\r$\nSome of your files are still in $nomiH (they are safe); they could not be moved back to $nomiL because files with the same names are there. Move them back by hand."
      ${EndIf}
    FunctionEnd

    ; 挪回本次挪开的全部位置。可重复调用：挪过一次就清空槽位。
    Function nomiRestoreKept
      Push $nomiL
      Push $nomiH
      Push $nomiSlot
      ${If} $nomiKeep1 != ""
        StrCpy $nomiL $nomiKeep1
        StrCpy $nomiSlot "1"
        StrCpy $nomiKeep1 ""
        Call nomiRestoreOne
      ${EndIf}
      ${If} $nomiKeep2 != ""
        StrCpy $nomiL $nomiKeep2
        StrCpy $nomiSlot "2"
        StrCpy $nomiKeep2 ""
        Call nomiRestoreOne
      ${EndIf}
      Pop $nomiSlot
      Pop $nomiH
      Pop $nomiL
    FunctionEnd

    ; UAC 内层（提权后的）实例里模板不跑「应用还开着」检查（installSection.nsh:35-37），customCheckAppRunning 不会被调用，
    ; 由这个排在安装段之前的隐藏段挪开；外层实例要么在页面上提权后退出、要么在安装段开头提权后退出，都到不了挪开这一步。
    Section "-nomiKeepUserFilesElevated"
      ${If} ${UAC_IsInnerInstance}
        Call nomiKeepAside
      ${EndIf}
    SectionEnd
  !endif
!macroend
