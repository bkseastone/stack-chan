#!/bin/bash
# MODIFICATION HISTORY
#  --------------------
# 2022/08/15, by wangweisong, create.
# 2025/10/25, by wangweisong, set up more prerequisites.
# 
# NOTICE
#  --------------------
# ENV: bash 4.0+ 
. ~/.bashrc

# set -euxo pipefail

# 获取工作目录和脚本目录
_script_dir=$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")
TOOLS_KIT_DIR=${_script_dir}/tools-kit

function print_help() {
   echo "Usage: bash run.sh --task_name={DIR_NAME} [-h|-d]"
   echo ""
   echo "   eg1: bash run.sh --task_name=init_env"
   echo "   eg1: bash run.sh --task_name=build_deploy"
   echo "   eg2: bash run.sh --task_name=deploy"
   echo "   eg3: bash run.sh --task_name=mod --mod_cfg=~/workspace/M5Stack/stack-chan/firmware/mods/wws_test/manifest.json"
   echo ""
   echo "Options:"
   echo "  -h, --help                   Print this message and exit"
   echo "  -d, --debug                  Print debug info"
   echo "  --task_name                  Sepcify the task direction"
   echo ""
}

function check_cmd() {
    if [[ "${kwargs[help]}" ]]; then
        print_help
        exit 0
    fi

    if [[ -z "${kwargs[task_name]}" ]]; then
        echo "invalid value of --task_name option"
        print_help
        exit 1
    fi
}

function init_env() {
    if [[ -f ${TOOLS_KIT_DIR}/.safe ]]; then 
        return
    fi
    _script_dir=$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")
    tools_kit_path=${TOOLS_KIT_DIR}/pkg.tar.gz
    mkdir -p ${TOOLS_KIT_DIR}
    rm -rf ${tools_kit_path}
    cd ${TOOLS_KIT_DIR} && wget https://www.weisong.space/release/tools-kit/pkg.tar.gz && tar -xf ${tools_kit_path}
}

# bitrate: 921600
# bitrate: 115200
# ENV: macos
function npm_run_deploy {
    cd ~/.local/share/moddable/build/bin/esp32/m5stack/debug/stackchan
    $HOME/.local/share/esp32/esp-idf/components/esptool_py/esptool/esptool.py \
        -p /dev/cu.usbserial-56D30069631 \
        -b 115200 \
        --before default_reset \
        --after hard_reset \
        --chip esp32 write_flash \
        --flash_mode dio \
        --flash_size detect \
        --flash_freq 40m \
        0x1000 bootloader.bin \
        0x8000 partition-table.bin \
        0x10000 xs_esp32.bin
    cd -
}

cd ${_script_dir}

# env && functions
init_env
source ${TOOLS_KIT_DIR}/lib/shell/functions.sh

# python 脚本调用
py_lib_dir="${TOOLS_KIT_DIR}/lib/python"
function py_func() {
    python3.10 -c '
import os
import sys
LIB_PATH = os.path.join("'${py_lib_dir}'", ".")
sys.path.append(LIB_PATH)
from time_helper import date_range

print(" ".join(date_range("20230225", "20230303")))
'
    [[ $? -ne 0 ]] && colors_fatal "py_func failed" && exit 1
}

# cpp 脚本调用
# ...

# 入参解析
init_arg_alias
parse_arguments "$@"
check_cmd

# 主程序
function main() {
    colors_info "task_name is ${kwargs[task_name]}"
    if [[ "x${kwargs[task_name]}" == "xinit_env" ]]; then
        cd ${_script_dir}
        npm i  # 安装交叉编译工具
        npm run setup                    # 安装ModdableSDK
        npm run setup -- --device=esp32  # 安装ESP-IDF (注意与ModdableSDK的先后顺序)
        mv $HOME/.local/share/moddable $HOME/.local/share/moddable.bak
        npm run setup_patch              # 
    fi
    if [[ "x${kwargs[task_name]}" == "xbuild_deploy" ]]; then
        # export PATH="$HOME/.espressif/python_env/idf4.4_py3.9_env/bin:$PATH"
        cd ${_script_dir} && npm run build ssid="CU_601" password="18612527669"
        [[ $? -eq 0 ]] && npm_run_deploy
    fi
    if [[ "x${kwargs[task_name]}" == "xdeploy" ]]; then
        npm_run_deploy
    fi
    if [[ "x${kwargs[task_name]}" == "xmod" ]]; then
        cd ${_script_dir}
        npm run mod "${kwargs[mod_cfg]}"
    fi
}

trap 'colors_fatal "trap..."; exit $1' INT TERM EXIT    
{
    main
}
trap - INT TERM EXIT  # 重置信号

exit 0