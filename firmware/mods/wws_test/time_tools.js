export function getTimeString() {
    let date = new Date();
    let yyyy = date.getFullYear();
    let MM = (date.getMonth()+1 < 10 ? '0'+(date.getMonth()+1) : date.getMonth()+1);
    let dd = date.getDate();
    let hh = date.getHours();
    let mm = date.getMinutes();
    let ss = date.getSeconds();
    return `[LanguageEngine] debug date: ${yyyy}-${MM}-${dd} ${hh}:${mm}:${ss}\n`
}

export function getTimeNumber() {
    return Date.now()
}