fn main(x: Field, y: pub Field) {
    assert(x as u8 > y as u8);
}

#[test]
fn test_main() {
    main(1, 2);

    // Uncomment to make test fail
    // main(1, 1);
}
