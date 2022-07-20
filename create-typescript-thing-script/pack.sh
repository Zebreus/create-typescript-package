input=$1
output=$2

# Create new cp_resource_file function with packed files

echo "cp_resource_file() { " > cp_resource_file.sh

find resources -type f | while read file; do
    filename="$(basename $file)"
    echo 'if test "$1" = "'$filename'" ; then' >> cp_resource_file.sh
    echo 'mkdir -p resources_tmp' >> cp_resource_file.sh
    echo 'cat <<\EOF_SUFFIX > "resources_tmp/'$filename'"' >> cp_resource_file.sh
    cat $file >> cp_resource_file.sh
    echo "" >> cp_resource_file.sh
    echo "EOF_SUFFIX" >> cp_resource_file.sh
    echo 'cp "resources_tmp/'$filename'" "$2"' >> cp_resource_file.sh
    echo 'rm -rf resources_tmp' >> cp_resource_file.sh
    echo 'return 0' >> cp_resource_file.sh
    echo 'fi' >> cp_resource_file.sh
done

echo 'echo "Failed to find file $1 in resources" ; exit 1' >> cp_resource_file.sh
echo "}" >> cp_resource_file.sh

oldline="$(grep -Fxn 'cp_resource_file() { cp "$SCRIPTPATH/resources/$1" "$2" ; }' "$input" | cut -f1 -d: | head -n1)"

if test -z "$oldline"; then
    echo "Failed to find cp_resource_file() in $input" >&2
    exit 1
fi



cat <(head -n$(( $oldline - 1 )) "$input") \
    <(cat cp_resource_file.sh) \
    <(tail -n+$(( $oldline + 1 )) "$input") \
    > "$output"

rm cp_resource_file.sh